/**
 * Action-correlated presentation phases (#1218; doc/action-presentation-phases.md). One action
 * record per committed action, keyed by captured run generation and opaque `actionId`, with
 * required contributions reserved before anything can settle, phase barriers, ordered
 * contributions and bounded binding, all on the one shared visual scheduler.
 *
 * - **Reservation first.** On commit the record snapshots the composition's producers (by
 *   registered capability, in composition order) and asks each to reserve. Every reservation is a
 *   contribution scope under its phase scope, holding one bounded `actionPhase.hold` effect, so no
 *   phase or root can settle while any reserved contribution is unbound, whatever the producers'
 *   order. The collection then closes: a late producer or stale lookup gets `null`.
 * - **Binding.** A producer later binds its actual work (one scheduler event description), or
 *   settles empty, or fails, exactly once. The hold starts the bound work as its own descendant
 *   only when its gates open: the plan's preceding phase finished (a cancelled or failed
 *   predecessor fails it), and, for an ordered contribution, the previous action's contribution in
 *   that chain is terminal. An unbound hold past the configured limit (450 units by default) fails
 *   its scope, whose registered summary fallback runs once.
 * - **Observation.** `status`/`observe` by action key and phase report the scheduler's own terminal
 *   states (finished, cancelled, failed), or `unavailable` for an unknown or stale record.
 * - **Lifecycle.** `reset()` cancels every record of the generation and starts a new one; records
 *   are bounded and terminal ones are evicted first; overflow is rejected with a diagnostic.
 *
 * It stores handles and status only: no gameplay policy, no `GameRun`, no second timed queue.
 * Phase plans and producers are registered capabilities, chosen by reference, never by identity.
 */
import { Registry } from "../core/registry";
import {
  unitMs,
  visualFallbacks,
  visualHandlers,
  type EffectHandle,
  type EventDescription,
  type ScopeHandle,
  type ScopeStatus,
  type VisualScheduler,
} from "./scheduler";

/** The protocol slots, in order: each phase opens when the one before it finishes. */
export type PhasePlan = { slots: readonly string[] };
export const phasePlans = new Registry<PhasePlan>("action phase plan");

/** The scoring action plan: pre-scoring, scoring, then post-scoring. */
phasePlans.register("scoring", { slots: ["preScoring", "scoring", "postScoring"] });

/** What a producer reserves for one committed action, or null for no contribution. */
export type Reservation = { slot: string; ordered?: string } | null;

/** A registered producer capability: it decides from the captured record whether it contributes. */
export type PhaseProducer = { reserve(captured: unknown): Reservation };
export const phaseProducers = new Registry<PhaseProducer>("action phase producer");

export type ActionKey = { generation: number; actionId: string };

/** A reserved contribution: the producer binds, empties or fails it, once. */
export type Contribution = {
  readonly slot: string;
  /** Bind the actual work; it starts once the gates open. False if already settled. */
  bind(work: EventDescription): boolean;
  /** Nothing to show for this action after all. */
  settleEmpty(): boolean;
  /** The producer failed: its scope fails and the summary fallback runs once. */
  fail(reason: string): boolean;
  status(): ScopeStatus;
  /** Hear its terminal status once (#1280); returns an unsubscribe. */
  observe(listener: (status: ScopeStatus) => void): () => void;
};

type Hold = {
  state: "waiting" | "bound" | "empty" | "failed" | "done";
  work: EventDescription | null;
  reason: string;
  gates(): "open" | "wait" | { failed: string };
};

/** Live holds by opaque id: scheduler payloads are plain data, so the hold names its record. */
const holds = new Map<string, Hold>();
let nextHold = 0;

visualHandlers.register("actionPhase.hold", (payload, context): EffectHandle => {
  const id = (payload as { hold: string }).hold;
  return {
    update(nowMs) {
      const hold = holds.get(id);
      if (!hold || hold.state === "done") return "finished";
      if (hold.state === "failed") {
        hold.state = "done";
        throw new Error(hold.reason);
      }
      if (hold.state === "waiting") return "running";
      const gate = hold.gates();
      if (gate === "wait") return "running";
      if (gate !== "open") {
        hold.state = "done";
        throw new Error(gate.failed);
      }
      const work = hold.work;
      hold.state = "done";
      if (work) {
        // Due now, when the gates actually opened, not when the hold started (#1251).
        const admitted = context.schedule({ ...work, dueUnits: nowMs / unitMs });
        if (!admitted.accepted) throw new Error(`bound work not admitted: ${admitted.reason}`);
      }
      return "finished";
    },
    cancel() {
      const hold = holds.get(id);
      if (hold) hold.state = "done";
    },
    dispose() {
      holds.delete(id);
    },
  };
});

/**
 * An explicit completion adapter (#1220; doc/action-presentation-phases.md, "Existing work created
 * before adoption is joined through an explicit completion adapter"): bound as a contribution's
 * work, its effect runs until the existing producer reports its own work done, or failed.
 */
export type CompletionAdapter = {
  /** The bound work's description: bind the contribution to this. */
  readonly work: EventDescription;
  /** The producer's work has completed. */
  done(): void;
  /** The producer's work failed: the contribution fails and its summary runs. */
  failed(reason: string): void;
};

const completions = new Map<string, { state: "waiting" | "done" | "failed"; reason: string }>();
let nextCompletion = 0;

visualHandlers.register("actionPhase.completion", (payload): EffectHandle => {
  const id = (payload as { completion: string }).completion;
  return {
    update() {
      const completion = completions.get(id);
      if (!completion || completion.state === "done") return "finished";
      if (completion.state === "failed") throw new Error(completion.reason);
      return "running";
    },
    cancel() {
      completions.delete(id);
    },
    dispose() {
      completions.delete(id);
    },
  };
});

/** A completion adapter for an existing producer's work. */
export function createCompletionAdapter(): CompletionAdapter {
  const id = `completion-${++nextCompletion}`;
  completions.set(id, { state: "waiting", reason: "" });
  const settle = (state: "done" | "failed", reason = "") => {
    const completion = completions.get(id);
    if (completion?.state === "waiting") completions.set(id, { state, reason });
  };
  return {
    work: { handler: "actionPhase.completion", payload: { completion: id }, dueUnits: 0 },
    done: () => settle("done"),
    failed: (reason) => settle("failed", reason),
  };
}

type ActionRecord = {
  key: ActionKey;
  root: ScopeHandle;
  slots: Map<string, ScopeHandle>;
  contributions: Map<string, Contribution>;
};

export type ActionPhasesOptions = {
  /** The registered phase plan. */
  plan: string;
  /** Producer capability names, in composition order. */
  producers: readonly string[];
  /** Game-time units an unbound reservation may hold before failing (default 450). */
  bindLimitUnits?: number;
  /** Records kept, terminal ones evicted first (default 64). */
  maxRecords?: number;
  /** A registered scheduler fallback that summarises a failed contribution from its payload. */
  fallback?: string;
  /** The services the scheduler hands its fallbacks, for summaries this registry runs itself. */
  services?: unknown;
};

export function createActionPhases(scheduler: VisualScheduler, options: ActionPhasesOptions) {
  const plan = phasePlans.get(options.plan);
  const bindLimitMs = (options.bindLimitUnits ?? 450) * unitMs;
  const maxRecords = options.maxRecords ?? 64;
  let generation = 1;
  const records = new Map<string, ActionRecord>();
  /** Each ordered chain's latest contribution scope, this generation. */
  const chains = new Map<string, ScopeHandle>();
  const keyOf = ({ generation: g, actionId }: ActionKey) => `${g}:${actionId}`;
  const live = (key: ActionKey) =>
    key.generation === generation ? records.get(keyOf(key)) : undefined;
  const terminal = (scope: ScopeHandle) => scheduler.status(scope).state !== "pending";

  const evict = () => {
    for (const [id, record] of records) {
      if (records.size < maxRecords) return;
      if (terminal(record.root)) records.delete(id);
    }
  };

  return {
    get generation() {
      return generation;
    },
    /**
     * Open a committed action's record: snapshot the producers, reserve every contribution, then
     * close the collection. The producers' contributions come back by name.
     */
    commit(
      actionId: string,
      captured: unknown,
    ):
      | {
          ok: true;
          key: ActionKey;
          contributions: ReadonlyMap<string, Contribution>;
          /** Contributions that could not be reserved, each summarised once. */
          diagnostics: readonly string[];
        }
      | { ok: false; diagnostic: string } {
      const key = { generation, actionId };
      if (records.has(keyOf(key)))
        return { ok: false, diagnostic: `action ${actionId} already recorded` };
      evict();
      if (records.size >= maxRecords)
        return { ok: false, diagnostic: `action record limit ${maxRecords} reached` };
      const producers = options.producers.map((name) => ({
        name,
        producer: phaseProducers.get(name),
      }));
      const root = scheduler.createScope(null);
      const slots = new Map(plan.slots.map((slot) => [slot, scheduler.createScope(root)]));
      const contributions = new Map<string, Contribution>();
      const diagnostics: string[] = [];
      /** A contribution that could not be reserved: its summary runs once, now. */
      const summarise = (producer: string, reason: string) => {
        diagnostics.push(`${producer}: ${reason}`);
        if (!options.fallback) return;
        // The same services and containment the scheduler gives its own fallbacks (#1255): a
        // throwing summary is reported afterwards and never interrupts the collection.
        try {
          visualFallbacks.get(options.fallback)({
            reason,
            services: options.services ?? null,
            payload: { producer, captured },
          });
        } catch (error) {
          diagnostics.push(
            `${producer}: summary failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          queueMicrotask(() => {
            throw error;
          });
        }
      };
      for (const { name, producer } of producers) {
        // One producer's throw is contained: the collection still closes (#1251).
        let reservation: Reservation;
        try {
          reservation = producer.reserve(captured);
        } catch (error) {
          summarise(
            name,
            `reserve failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }
        if (!reservation) continue;
        const slotScope = slots.get(reservation.slot);
        if (!slotScope)
          throw new Error(`Slot "${reservation.slot}" is not in plan "${options.plan}"`);
        const scope = scheduler.createScope(slotScope, {
          maxEffectMs: bindLimitMs,
          ...(options.fallback
            ? { fallback: options.fallback, fallbackPayload: { producer: name, captured } }
            : {}),
        });
        // Every earlier slot is a barrier, not only the one before: an empty slot settles at
        // once and must not let a later one skip past a pending earlier one (#1251).
        const position = plan.slots.indexOf(reservation.slot);
        const earlier = plan.slots.slice(0, Math.max(0, position)).map((slot) => ({
          slot,
          scope: slots.get(slot)!,
        }));
        const previousInChain = reservation.ordered
          ? (chains.get(reservation.ordered) ?? null)
          : null;
        if (reservation.ordered) chains.set(reservation.ordered, scope);
        const hold: Hold = {
          state: "waiting",
          work: null,
          reason: "",
          gates: () => {
            for (const { slot, scope: barrier } of earlier) {
              const status = scheduler.status(barrier);
              if (status.state === "pending") return "wait";
              if (status.state !== "finished") return { failed: `${slot} ${status.state}` };
            }
            if (previousInChain && !terminal(previousInChain)) return "wait";
            return "open";
          },
        };
        const id = `hold-${++nextHold}`;
        holds.set(id, hold);
        const admitted = scheduler.schedule(scope, {
          handler: "actionPhase.hold",
          payload: { hold: id },
          dueUnits: scheduler.nowMs / unitMs,
        });
        if (!admitted.accepted) {
          // Not admitted: nothing holds this contribution, so it is summarised and cancelled
          // rather than sealed empty as if it had been bound (#1251).
          holds.delete(id);
          hold.state = "done";
          summarise(name, `reservation not admitted: ${admitted.reason}`);
          scheduler.cancel(scope);
        } else scheduler.seal(scope);
        const settle = (
          state: Hold["state"],
          work: EventDescription | null = null,
          reason = "",
        ) => {
          if (hold.state !== "waiting") return false;
          hold.state = state;
          hold.work = work;
          hold.reason = reason;
          return true;
        };
        contributions.set(name, {
          slot: reservation.slot,
          bind: (work) => settle("bound", work),
          settleEmpty: () => settle("empty"),
          fail: (reason) => settle("failed", null, reason),
          status: () => scheduler.status(scope),
          observe: (listener) => scheduler.observe(scope, listener),
        });
      }
      // The collection is closed: everything required is reserved before anything can settle.
      for (const scope of slots.values()) scheduler.seal(scope);
      scheduler.seal(root);
      records.set(keyOf(key), { key, root, slots, contributions });
      return { ok: true, key, contributions, diagnostics };
    },
    /** A producer's reserved contribution, or null for a late producer or stale record. */
    contribution(key: ActionKey, producer: string): Contribution | null {
      return live(key)?.contributions.get(producer) ?? null;
    },
    /** A slot's status (or the whole action's, without a slot), or unavailable. */
    status(key: ActionKey, slot?: string): ScopeStatus | "unavailable" {
      const record = live(key);
      if (!record) return "unavailable";
      const scope = slot ? record.slots.get(slot) : record.root;
      return scope ? scheduler.status(scope) : "unavailable";
    },
    /** Observe a slot (or the action) settling; null when unavailable. */
    observe(key: ActionKey, slot: string | null, listener: (status: ScopeStatus) => void) {
      const record = live(key);
      const scope = record && (slot ? record.slots.get(slot) : record.root);
      return scope ? scheduler.observe(scope, listener) : null;
    },
    /** End this generation: every record cancelled once, chains dropped, lookups unavailable. */
    reset() {
      for (const record of records.values()) scheduler.cancel(record.root);
      records.clear();
      chains.clear();
      generation += 1;
    },
  };
}

export type ActionPhases = ReturnType<typeof createActionPhases>;
