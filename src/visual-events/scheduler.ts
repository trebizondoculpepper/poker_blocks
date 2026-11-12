/**
 * The shared visual-event scheduler (#546; doc/game-architecture.md, "Visual-event scheduler and
 * game-time units", and doc/visual-event-interface.md). A presentation service: controller traits
 * decide *what* to present; this decides *when* it starts and tracks when it has finished. It
 * presents outcomes the model already committed, so it never evaluates gameplay, never touches the
 * run's random stream, and never holds input back.
 *
 * - **One clock.** Presentation time, in milliseconds, advanced by visible elapsed time only:
 *   hidden time is excluded and the next visible timestamp rebases it. Configuration speaks in
 *   game-time units (1/15 s); only the clock converts.
 * - **Ordering.** Due events start in (due time, insertion order), held by a pinned TinyQueue heap.
 *   A late frame starts each due event exactly once, at its *scheduled* time.
 * - **Scopes.** Events belong to scopes that nest. A sealed scope settles only when its pending
 *   events, active effects and child scopes have all settled. Cancelling cascades, once.
 * - **Bounds.** Finite caps on pending, per-scope, active, starts per update, depth and effect
 *   duration. A rejected admission changes no count; an effect over its time is cancelled, the
 *   scope is marked failed and its producer's registered fallback runs once.
 * - **Handlers** are registered by key and own all behaviour. The scheduler never asks what an
 *   event is. A handler gets the clock, its scope and scheduling capabilities, and the services it
 *   was given; never the run, mutation or the session's random stream.
 *
 * Nothing in the game uses it yet: migrations (#547 onward) move presentation onto it one at a time.
 */
import TinyQueue from "tinyqueue";
import { Registry } from "../core/registry";

/** One game-time unit, in milliseconds (1/15 s). */
export const unitMs = 1000 / 15;
export const unitsToMs = (units: number): number => units * unitMs;

/** The documented initial bounds (doc/visual-event-interface.md, "Initial bounds and fallback"). */
export type SchedulerLimits = {
  pendingGlobal: number;
  pendingPerScope: number;
  activeGlobal: number;
  startsPerUpdate: number;
  depth: number;
  maxEffectMs: number;
};
export const defaultLimits: SchedulerLimits = {
  pendingGlobal: 4096,
  pendingPerScope: 1024,
  activeGlobal: 512,
  startsPerUpdate: 128,
  depth: 32,
  maxEffectMs: 30_000,
};

/** A running effect: advanced on the clock until it reports finished, then disposed once. */
export type EffectHandle = {
  update(nowMs: number): "running" | "finished";
  cancel(): void;
  dispose(): void;
};

export type ScopeState = "pending" | "finished" | "cancelled" | "failed";
export type ScopeStatus = { state: ScopeState; diagnostic?: string };

export type EventDescription = {
  handler: string;
  payload?: unknown;
  /** Absolute presentation time, in units. */
  dueUnits: number;
  /** The captured start of the action or phase, in units, for relative clients. */
  originUnits?: number;
};

export type Admission =
  | { accepted: true; handle: EventHandle }
  | { accepted: false; reason: string };

/** What a handler is given: never the run, mutation or the session's random stream. */
export type HandlerContext = {
  nowMs: number;
  scheduledAtMs: number;
  scope: ScopeHandle;
  /** Schedule a descendant of this event (in its scope, one level deeper). */
  schedule(description: EventDescription): Admission;
  cancel(target: EventHandle | ScopeHandle): void;
  services: unknown;
};

/** A handler settles at once (`"done"`) or returns an effect that runs until it finishes. */
export type VisualHandler = (payload: unknown, context: HandlerContext) => "done" | EffectHandle;

/** A producer's summary fallback, run once when its scope fails (a timeout, a thrown handler). */
export type VisualFallback = (failure: { reason: string; services: unknown }) => void;

export const visualHandlers = new Registry<VisualHandler>("visual event handler");
export const visualFallbacks = new Registry<VisualFallback>("visual fallback");

export type ScopeConfig = {
  /** A per-scope pending cap, no higher than the global per-scope limit. */
  maxPending?: number;
  /** A shorter (or separately bounded longer) effect time limit for this scope. */
  maxEffectMs?: number;
  /** The registered fallback that runs once if the scope fails. */
  fallback?: string;
};

declare const scopeBrand: unique symbol;
declare const eventBrand: unique symbol;
/** Opaque handles: code holds them, never reads into them. */
export type ScopeHandle = { readonly [scopeBrand]: true };
export type EventHandle = { readonly [eventBrand]: true };

type Scope = {
  handle: ScopeHandle;
  generation: number;
  parent: Scope | null;
  children: Set<Scope>;
  events: Set<Entry>;
  config: ScopeConfig;
  sealed: boolean;
  state: ScopeState;
  diagnostic?: string;
  pending: number;
  active: number;
  failure: string | null;
  fallbackRan: boolean;
  /** Being cancelled: its children's settling must not report it finished (#785 review). */
  cancelling: boolean;
  listeners: Set<(status: ScopeStatus) => void>;
};

type Entry = {
  handle: EventHandle;
  scope: Scope;
  handler: string;
  payload: unknown;
  dueAtMs: number;
  sequence: number;
  depth: number;
  state: "pending" | "active" | "settled";
  effect: EffectHandle | null;
  cancelling: boolean;
};

/**
 * A plain, immutable copy of a payload: null, booleans, finite numbers, strings, arrays and plain
 * objects only. Meshes, controllers, callbacks and other live objects are refused before
 * admission, so nothing mutable reaches a delayed effect.
 */
export function capturePayload(value: unknown, depth = 0): unknown {
  if (depth > 64) throw new Error("payload too deep");
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("payload number must be finite");
    return value;
  }
  if (Array.isArray(value))
    return Object.freeze(value.map((item) => capturePayload(item, depth + 1)));
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null)
      throw new Error("payload must be plain data");
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          capturePayload(item, depth + 1),
        ]),
      ),
    );
  }
  throw new Error(`payload cannot hold a ${typeof value}`);
}

export function createVisualScheduler(
  options: {
    handlers?: Pick<Registry<VisualHandler>, "has" | "get">;
    fallbacks?: Pick<Registry<VisualFallback>, "has" | "get">;
    limits?: Partial<SchedulerLimits>;
    services?: unknown;
  } = {},
) {
  const handlers = options.handlers ?? visualHandlers;
  const fallbacks = options.fallbacks ?? visualFallbacks;
  const limits: SchedulerLimits = { ...defaultLimits, ...options.limits };
  for (const [key, value] of Object.entries(limits))
    if (
      !(value > 0) ||
      !Number.isFinite(value) ||
      (key !== "maxEffectMs" && !Number.isInteger(value))
    )
      throw new Error(`Invalid scheduler limit ${key}: ${value}`);
  const services = options.services;

  const order = (a: Entry, b: Entry) => a.dueAtMs - b.dueAtMs || a.sequence - b.sequence;
  let heap = new TinyQueue<Entry>([], order);
  const scopes = new Map<ScopeHandle, Scope>();
  const entries = new Map<EventHandle, Entry>();
  const active = new Set<Entry>();
  let generation = 0;
  let sequence = 0;
  let pending = 0;
  let nowMs = 0;
  let lastRealMs: number | null = null;
  let updating = false;

  /** Rebuild the heap from what is still pending: TinyQueue has no delete (O(n), bounded). */
  const rebuild = () => {
    heap = new TinyQueue<Entry>(
      [...entries.values()].filter(({ state }) => state === "pending"),
      order,
    );
  };

  const notify = (scope: Scope) => {
    const status = statusOf(scope);
    const listeners = Array.from(scope.listeners);
    scope.listeners.clear();
    // A throwing observer can't stop the bookkeeping: its error is reported after the settlement
    // has finished propagating to the ancestors (#785 review).
    for (const listener of listeners)
      try {
        listener(status);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
  };
  const statusOf = (scope: Scope): ScopeStatus =>
    scope.diagnostic
      ? { state: scope.state, diagnostic: scope.diagnostic }
      : { state: scope.state };

  /** Run a scope's fallback once, through its direct sink; a failing sink leaves it failed. */
  const runFallback = (scope: Scope, reason: string) => {
    if (scope.fallbackRan || !scope.config.fallback) return;
    scope.fallbackRan = true;
    try {
      fallbacks.get(scope.config.fallback)({ reason, services });
    } catch (error) {
      scope.failure ??= `fallback failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  const fail = (scope: Scope, reason: string) => {
    scope.failure ??= reason;
    runFallback(scope, reason);
  };

  /** Settle a scope once everything it owns has settled, then its parent may settle. */
  const settleIfDone = (scope: Scope) => {
    if (scope.state !== "pending" || scope.cancelling || !scope.sealed) return;
    if (scope.pending > 0 || scope.active > 0) return;
    for (const child of scope.children) if (child.state === "pending") return;
    scope.state = scope.failure ? "failed" : "finished";
    if (scope.failure) scope.diagnostic = scope.failure;
    scope.events.clear();
    notify(scope);
    if (scope.parent) settleIfDone(scope.parent);
  };

  const finishEntry = (entry: Entry) => {
    if (entry.state === "settled") return;
    const wasActive = entry.state === "active";
    entry.state = "settled";
    entries.delete(entry.handle);
    // Released from its scope too, so a long-lived scope holds only live work (#785 review).
    entry.scope.events.delete(entry);
    entry.payload = null;
    if (wasActive) {
      active.delete(entry);
      entry.scope.active--;
      entry.effect?.dispose();
      entry.effect = null;
    } else {
      pending--;
      entry.scope.pending--;
    }
    settleIfDone(entry.scope);
  };

  /** An effect's cancel callback runs once, even if it re-enters cancellation (#785 review). */
  const cancelEffect = (entry: Entry) => {
    if (entry.cancelling) return;
    entry.cancelling = true;
    entry.effect?.cancel();
  };

  const cancelEntry = (entry: Entry) => {
    if (entry.state === "settled" || entry.cancelling) return;
    if (entry.state === "active") cancelEffect(entry);
    finishEntry(entry);
  };

  const cancelScope = (scope: Scope) => {
    if (scope.state !== "pending" || scope.cancelling) return;
    // Marked first, so the children cancelled below cannot settle this scope as finished.
    scope.cancelling = true;
    for (const child of Array.from(scope.children)) cancelScope(child);
    const hadPending = [...scope.events].some(({ state }) => state === "pending");
    for (const entry of Array.from(scope.events)) {
      if (entry.state === "active") cancelEffect(entry);
      if (entry.state !== "settled") {
        const wasActive = entry.state === "active";
        entry.state = "settled";
        entries.delete(entry.handle);
        entry.payload = null;
        if (wasActive) {
          active.delete(entry);
          entry.effect?.dispose();
          entry.effect = null;
        } else pending--;
      }
    }
    scope.pending = 0;
    scope.active = 0;
    scope.events.clear();
    scope.state = "cancelled";
    notify(scope);
    if (hadPending) rebuild();
    if (scope.parent) settleIfDone(scope.parent);
  };

  const admit = (
    scope: Scope,
    description: EventDescription,
    depth: number,
    leased: boolean,
  ): Admission => {
    if (scope.generation !== generation) return { accepted: false, reason: "stale generation" };
    if (scope.state !== "pending") return { accepted: false, reason: "scope already settled" };
    if (scope.sealed && !leased) return { accepted: false, reason: "scope is sealed" };
    if (depth > limits.depth) return { accepted: false, reason: `deeper than ${limits.depth}` };
    if (!handlers.has(description.handler))
      return { accepted: false, reason: `unknown handler "${description.handler}"` };
    if (!Number.isFinite(description.dueUnits) || description.dueUnits < 0)
      return { accepted: false, reason: "due time must be finite and not negative" };
    if (pending >= limits.pendingGlobal) return { accepted: false, reason: "global pending limit" };
    const scopeCap = Math.min(
      scope.config.maxPending ?? limits.pendingPerScope,
      limits.pendingPerScope,
    );
    if (scope.pending >= scopeCap) return { accepted: false, reason: "scope pending limit" };
    let payload: unknown;
    try {
      payload = capturePayload(description.payload ?? null);
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
    const handle = { id: ++sequence } as unknown as EventHandle;
    const entry: Entry = {
      handle,
      scope,
      handler: description.handler,
      payload,
      dueAtMs: unitsToMs(description.dueUnits),
      sequence,
      depth,
      state: "pending",
      effect: null,
      cancelling: false,
    };
    entries.set(handle, entry);
    scope.events.add(entry);
    scope.pending++;
    pending++;
    heap.push(entry);
    return { accepted: true, handle };
  };

  const start = (entry: Entry) => {
    entry.state = "active";
    entry.scope.pending--;
    pending--;
    entry.scope.active++;
    active.add(entry);
    const lease = { open: true };
    const context: HandlerContext = {
      nowMs,
      scheduledAtMs: entry.dueAtMs,
      scope: entry.scope.handle,
      // A descendant registers under this event's open lease, even after its scope is sealed.
      schedule: (description) =>
        lease.open
          ? admit(entry.scope, description, entry.depth + 1, true)
          : { accepted: false, reason: "lease closed" },
      cancel: (target) => api.cancel(target),
      services,
    };
    let result: "done" | EffectHandle;
    try {
      result = handlers.get(entry.handler)(entry.payload, context);
    } catch (error) {
      lease.open = false;
      fail(
        entry.scope,
        `handler "${entry.handler}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      finishEntry(entry);
      return;
    }
    if (result === "done") {
      lease.open = false;
      finishEntry(entry);
      return;
    }
    // The handler cancelled its own scope (or event) before returning this effect: it was
    // never mounted, so it is cancelled and released at once, exactly once (#785 review).
    // Re-read: the handler may have settled this entry (TypeScript can't see that side effect).
    if ((entry.state as Entry["state"]) === "settled") {
      result.cancel();
      result.dispose();
      return;
    }
    entry.effect = {
      update: (now) => result.update(now),
      cancel: () => {
        lease.open = false;
        result.cancel();
      },
      dispose: () => {
        lease.open = false;
        result.dispose();
      },
    };
  };

  const api = {
    /** The presentation clock now, in milliseconds. */
    get nowMs(): number {
      return nowMs;
    },
    /** A scope in the current generation; producer registration open until sealed. */
    createScope(parent: ScopeHandle | null, config: ScopeConfig = {}): ScopeHandle {
      // A parent this generation doesn't know (a disposed run's scene, say) yields a cancelled
      // scope, never a fresh root that could mount old feedback in the new run (#785 review).
      const parentScope = parent ? (scopes.get(parent) ?? null) : null;
      const staleParent = parent !== null && parentScope === null;
      if (config.fallback && !fallbacks.has(config.fallback))
        throw new Error(`Unknown visual fallback "${config.fallback}"`);
      // Overrides keep the bounds: positive whole counts, finite positive durations (#785 review).
      if (
        config.maxPending !== undefined &&
        !(Number.isInteger(config.maxPending) && config.maxPending > 0)
      )
        throw new Error(`Invalid scope maxPending: ${config.maxPending}`);
      if (
        config.maxEffectMs !== undefined &&
        !(Number.isFinite(config.maxEffectMs) && config.maxEffectMs > 0)
      )
        throw new Error(`Invalid scope maxEffectMs: ${config.maxEffectMs}`);
      const handle = { id: ++sequence } as unknown as ScopeHandle;
      const scope: Scope = {
        handle,
        generation,
        parent: parentScope,
        children: new Set(),
        events: new Set(),
        config,
        sealed: false,
        state:
          staleParent ||
          (parentScope && (parentScope.state !== "pending" || parentScope.cancelling))
            ? "cancelled"
            : "pending",
        pending: 0,
        active: 0,
        failure: null,
        fallbackRan: false,
        cancelling: false,
        listeners: new Set(),
      };
      scopes.set(handle, scope);
      parentScope?.children.add(scope);
      return handle;
    },
    schedule(scope: ScopeHandle, description: EventDescription): Admission {
      const found = scopes.get(scope);
      return found
        ? admit(found, description, 1, false)
        : { accepted: false, reason: "unknown scope" };
    },
    /** All or nothing, in order: a rejected batch admits nothing and changes no count. */
    scheduleBatch(
      scope: ScopeHandle,
      descriptions: readonly EventDescription[],
    ): { accepted: true; handles: EventHandle[] } | { accepted: false; reason: string } {
      const found = scopes.get(scope);
      if (!found) return { accepted: false, reason: "unknown scope" };
      const scopeCap = Math.min(
        found.config.maxPending ?? limits.pendingPerScope,
        limits.pendingPerScope,
      );
      if (pending + descriptions.length > limits.pendingGlobal)
        return { accepted: false, reason: "global pending limit" };
      if (found.pending + descriptions.length > scopeCap)
        return { accepted: false, reason: "scope pending limit" };
      const admitted: EventHandle[] = [];
      for (const description of descriptions) {
        const result = admit(found, description, 1, false);
        if (!result.accepted) {
          for (const handle of admitted) {
            const entry = entries.get(handle)!;
            entry.state = "settled";
            entries.delete(handle);
            found.events.delete(entry);
            found.pending--;
            pending--;
          }
          rebuild();
          return { accepted: false, reason: result.reason };
        }
        admitted.push(result.handle);
      }
      return { accepted: true, handles: admitted };
    },
    /** The producer has no more initial work; the scope settles once everything it owns has. */
    seal(scope: ScopeHandle): boolean {
      const found = scopes.get(scope);
      if (!found || found.state !== "pending" || found.sealed) return false;
      found.sealed = true;
      settleIfDone(found);
      return true;
    },
    cancel(target: EventHandle | ScopeHandle): void {
      const entry = entries.get(target as EventHandle);
      if (entry) {
        const wasPending = entry.state === "pending";
        cancelEntry(entry);
        if (wasPending) rebuild();
        return;
      }
      const scope = scopes.get(target as ScopeHandle);
      if (scope) cancelScope(scope);
    },
    /** Cancel everything this generation owns; anything later from it does nothing. */
    disposeGeneration(): void {
      for (const scope of Array.from(scopes.values())) if (!scope.parent) cancelScope(scope);
      scopes.clear();
      entries.clear();
      active.clear();
      heap = new TinyQueue<Entry>([], order);
      pending = 0;
      generation++;
    },
    status(scope: ScopeHandle): ScopeStatus {
      const found = scopes.get(scope);
      return found ? statusOf(found) : { state: "cancelled", diagnostic: "unknown scope" };
    },
    /** Hear a scope settle; an already settled scope is reported once, at once. */
    observe(scope: ScopeHandle, listener: (status: ScopeStatus) => void): () => void {
      const found = scopes.get(scope);
      if (!found || found.state !== "pending") {
        listener(found ? statusOf(found) : { state: "cancelled", diagnostic: "unknown scope" });
        return () => {};
      }
      found.listeners.add(listener);
      return () => found.listeners.delete(listener);
    },
    /**
     * Advance the clock by visible elapsed time and dispatch, within the budget. One host calls
     * this; a handler that tried would be refused.
     */
    update(realNowMs: number, visible: boolean): void {
      if (updating) throw new Error("The visual scheduler cannot be updated from inside a handler");
      if (!visible) {
        // Hidden time is excluded: the next visible timestamp rebases the clock.
        lastRealMs = null;
        return;
      }
      if (lastRealMs !== null && realNowMs > lastRealMs) nowMs += realNowMs - lastRealMs;
      lastRealMs = realNowMs;
      updating = true;
      try {
        // Running effects first: finished ones settle, ones past their time fail their scope.
        for (const entry of Array.from(active)) {
          const limit = entry.scope.config.maxEffectMs ?? limits.maxEffectMs;
          if (nowMs - entry.dueAtMs > limit) {
            fail(entry.scope, `effect "${entry.handler}" exceeded ${limit} ms`);
            cancelEntry(entry);
            continue;
          }
          // A throwing effect fails its own scope and is released; the pass goes on (#785 review).
          let finished = false;
          try {
            finished = entry.effect !== null && entry.effect.update(nowMs) === "finished";
          } catch (error) {
            fail(
              entry.scope,
              `effect "${entry.handler}" failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            cancelEntry(entry);
            continue;
          }
          if (finished) finishEntry(entry);
        }
        // Then due starts, in order, within the budget and the active cap.
        let started = 0;
        for (;;) {
          const next = heap.peek();
          if (!next || next.dueAtMs > nowMs) break;
          if (started >= limits.startsPerUpdate || active.size >= limits.activeGlobal) break;
          heap.pop();
          if (next.state !== "pending") continue;
          started++;
          start(next);
        }
      } finally {
        updating = false;
      }
    },
    /** Counts, for diagnostics and tests: what is pending, active and still held. */
    get counts() {
      return {
        pending,
        active: active.size,
        heap: heap.length,
        entries: entries.size,
        scopes: scopes.size,
      };
    },
  };
  return api;
}

export type VisualScheduler = ReturnType<typeof createVisualScheduler>;
