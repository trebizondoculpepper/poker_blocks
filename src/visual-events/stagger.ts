/**
 * Staggered presentation (#542; doc/game-architecture.md, "`staggerEvents`", and
 * doc/visual-event-interface.md, "Migration order and acceptance", step 5).
 *
 * A stagger is one presentation decision: an ordered sequence of events that starts the first at
 * once and each later one a fixed number of game-time units after the one before. Rack pulses,
 * activations read left to right, are the motivating case; the mechanism knows nothing about racks,
 * passives or scoring, so any ordered sequence can use it.
 *
 * - **Its own scope.** A stagger owns a child scope of the caller's, and returns it: the documented
 *   contract is that "it returns a scope that settles when every child has settled". So a caller
 *   can await or cancel *this stagger* without waiting for, or disturbing, the other work composed
 *   into the same action scope. The child inherits the caller's fallback and limits.
 * - **Completion after every child.** The child is sealed as soon as its steps are admitted, so it
 *   settles only when the last child has — including a child whose effect outlives the next one's
 *   start, and children that register descendants of their own.
 * - **All or nothing.** Admission goes through `scheduleBatch`, so a sequence that cannot fit is
 *   rejected whole and leaves no partial admission behind. A rejected stagger cancels its own child
 *   scope and reports the scheduler's reason, so no empty pending scope is left behind either.
 * - **Times are the caller's, in units.** The origin is captured once, so a late frame or a delayed
 *   dispatch keeps every child's *scheduled* start rather than compressing the sequence.
 * - **No model access.** Payloads are the caller's already-captured data; nothing here reads the
 *   run, mutates state, draws random numbers or holds input back.
 */
import {
  type EventDescription,
  type ScopeConfig,
  type ScopeHandle,
  type VisualScheduler,
} from "./scheduler";

/** Game-time units between one staggered event and the next, unless configured otherwise. */
export const staggerSpacingUnits = 2;

export type StaggerOptions = {
  /** Units between consecutive events; omitted, `staggerSpacingUnits`. */
  spacingUnits?: number;
  /** Units before the first event; omitted, 0, so it starts immediately. */
  firstUnits?: number;
  /** The child scope's own configuration (fallback and limits); it inherits none by default. */
  scope?: ScopeConfig;
};

/**
 * One event in a stagger, without its time: the caller supplies what to present, and this module
 * owns when it starts. The fields are the same ones `EventDescription` uses.
 */
export type StaggerStep = Pick<EventDescription, "handler" | "payload">;

export type StaggerAdmission =
  | { accepted: true; scope: ScopeHandle }
  | { accepted: false; reason: string };

/**
 * Schedule `steps` in order into a new child of `parent`: the first at `firstUnits`, each later one
 * `spacingUnits` after its predecessor. Absolute due times are used rather than per-child delays, so
 * the whole sequence has one captured origin and cannot drift as the queue advances.
 *
 * The returned `scope` is the stagger's own: observe it to await the whole sequence, or cancel it to
 * stop only this sequence's remaining steps. `parent` may be null for a root stagger.
 */
export function staggerEvents(
  scheduler: VisualScheduler,
  parent: ScopeHandle | null,
  originUnits: number,
  steps: readonly StaggerStep[],
  options: StaggerOptions = {},
): StaggerAdmission {
  const spacing = options.spacingUnits ?? staggerSpacingUnits;
  const first = options.firstUnits ?? 0;
  if (!Number.isFinite(spacing) || spacing < 0)
    return { accepted: false, reason: `invalid spacing: ${spacing}` };
  if (!Number.isFinite(first) || first < 0)
    return { accepted: false, reason: `invalid first: ${first}` };
  if (!Number.isFinite(originUnits))
    return { accepted: false, reason: `invalid origin: ${originUnits}` };
  const scope = scheduler.createScope(parent, options.scope);
  const admitted = scheduler.scheduleBatch(
    scope,
    steps.map((step, index) => ({
      handler: step.handler,
      payload: step.payload,
      dueUnits: originUnits + first + index * spacing,
      originUnits,
    })),
  );
  if (!admitted.accepted) {
    // Nothing was admitted: give the unused child back rather than leaving a pending scope.
    scheduler.cancel(scope);
    return { accepted: false, reason: admitted.reason };
  }
  scheduler.seal(scope);
  return { accepted: true, scope };
}

/** Where a step's start falls, in units, for a caller that needs the same arithmetic (#542). */
export const staggeredStartUnits = (
  originUnits: number,
  index: number,
  firstUnits = 0,
  spacingUnits: number = staggerSpacingUnits,
): number => originUnits + firstUnits + index * spacingUnits;
