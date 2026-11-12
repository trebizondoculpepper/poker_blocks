/**
 * The per-action resolution context (#657, part of #612; doc/game-events.md, "Event and command
 * contract" and "Delivery order, cascades and failure").
 *
 * - **Envelopes.** Every gameplay fact an action produces is wrapped with a unique event ID, the
 *   action ID and a sequence number, its parent event (when caused by another), its phase, an
 *   optional batch ID and ordered subject IDs, and a snapshot version. Its payload is captured
 *   deeply immutable: freezing only the outer object is not enough. IDs correlate; they never
 *   choose behaviour.
 * - **Budget.** One action-wide budget covers delivered ordinary events and handler, command and
 *   trigger operations; nested drains do not replenish it. Overflow reports the ancestry, phase
 *   and responsible registration; it never truncates a result. No wall-clock limit.
 * - **Duplicate submission.** An action ID already resolved is rejected at the boundary.
 *
 * The transaction itself (staging state and the random cursor, rolling both back on failure, and
 * publishing nothing partial) is GameRun's `transact`, which owns that state.
 */

/** The run's resolution limits, configurable; the defaults are the documented initial values. */
export type ResolutionLimits = { events: number; operations: number };
export const defaultResolutionLimits: ResolutionLimits = { events: 128, operations: 4096 };

/** Freeze a captured value all the way down (arrays and nested objects too), once. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value as object))
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return value;
}

/** A captured gameplay fact with its correlation data. */
export type EventEnvelope<Payload = unknown> = Readonly<{
  eventId: string;
  type: string;
  actionId: string;
  sequence: number;
  parentId: string | null;
  phase: string;
  batchId: string | null;
  subjectIds: readonly string[];
  /** Which version of the model the captured payload describes. */
  snapshotVersion: number;
  payload: Payload;
}>;

/** The action ran out of its budget: thrown, so the transaction rolls back and reports it. */
export class ResolutionBudgetExceeded extends Error {
  readonly ancestry: readonly string[];
  readonly phase: string;
  readonly registration: string;

  constructor(
    kind: "events" | "operations",
    limit: number,
    context: { ancestry: readonly string[]; phase: string; registration: string },
  ) {
    super(
      `Action resolution budget exceeded (${kind} > ${limit}) in phase "${context.phase}" ` +
        `at ${context.registration}; ancestry: ${context.ancestry.join(" → ") || "(none)"}`,
    );
    this.name = "ResolutionBudgetExceeded";
    this.ancestry = context.ancestry;
    this.phase = context.phase;
    this.registration = context.registration;
  }
}

export type RecordOptions = {
  phase: string;
  parent?: EventEnvelope | null;
  batchId?: string | null;
  subjectIds?: readonly string[];
};

/** One action's resolution: its facts, in order, and its shared budget. */
export class ActionContext {
  readonly actionId: string;
  readonly limits: ResolutionLimits;
  readonly snapshotVersion: number;
  private readonly recorded: EventEnvelope[] = [];
  private delivered = 0;
  private operations = 0;

  constructor(actionId: string, snapshotVersion: number, limits = defaultResolutionLimits) {
    this.actionId = actionId;
    this.snapshotVersion = snapshotVersion;
    this.limits = limits;
  }

  /** Capture a fact: a deeply immutable payload in a correlated envelope. */
  record<Payload>(type: string, payload: Payload, options: RecordOptions): EventEnvelope<Payload> {
    const sequence = this.recorded.length;
    const envelope = deepFreeze({
      eventId: `${this.actionId}:${sequence}`,
      type,
      actionId: this.actionId,
      sequence,
      parentId: options.parent?.eventId ?? null,
      phase: options.phase,
      batchId: options.batchId ?? null,
      subjectIds: [...(options.subjectIds ?? [])],
      snapshotVersion: this.snapshotVersion,
      payload: structuredCloneable(payload),
    });
    this.recorded.push(envelope);
    return envelope;
  }

  /** The facts recorded so far, in order. */
  get facts(): readonly EventEnvelope[] {
    return this.recorded;
  }

  /** Count one delivered ordinary event against the action's budget. */
  deliver(event: { type: string }, phase: string, ancestry: readonly string[]): void {
    if (++this.delivered > this.limits.events)
      throw new ResolutionBudgetExceeded("events", this.limits.events, {
        ancestry: [...ancestry, event.type],
        phase,
        registration: event.type,
      });
  }

  /** Count one handler, command or trigger operation against the action's budget. */
  operate(registration: string, phase: string, ancestry: readonly string[]): void {
    if (++this.operations > this.limits.operations)
      throw new ResolutionBudgetExceeded("operations", this.limits.operations, {
        ancestry,
        phase,
        registration,
      });
  }

  /** What the action used, for diagnostics. */
  get usage(): { events: number; operations: number } {
    return { events: this.delivered, operations: this.operations };
  }
}

/**
 * Captured payloads are copied, so a later change to the live object can't reach them; the copy
 * is then frozen with the envelope, never the live state it came from. Plain objects and arrays
 * are copied; functions (a trait's description) are kept by reference, being code, not state.
 */
function structuredCloneable<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value) as T;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(structuredCloneable(item, seen));
    return copy as T;
  }
  const copy: Record<PropertyKey, unknown> = {};
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value))
    copy[key] = structuredCloneable((value as Record<PropertyKey, unknown>)[key], seen);
  return copy as T;
}

/**
 * Rejects an action ID that already resolved, so a duplicate submission does nothing. It keeps
 * every ID for the run's lifetime (#661 review): forgetting one would let a replayed submission
 * through and reuse its event IDs. One short string per action is a small cost.
 */
export class ActionLedger {
  private readonly seen = new Set<string>();
  private counter = 0;

  /**
   * A fresh action ID for an action submitted without one: in its own namespace, and never one
   * already resolved, so it can't collide with a caller's explicit ID (#661 review).
   */
  next(kind: string): string {
    let id: string;
    do id = `auto:${kind}-${++this.counter}`;
    while (this.seen.has(id));
    return id;
  }

  /** Whether this action ID has already resolved. */
  has(actionId: string): boolean {
    return this.seen.has(actionId);
  }

  /** Remember a resolved action ID (bounded: the oldest are forgotten). */
  remember(actionId: string): void {
    this.seen.add(actionId);
  }
}
