/**
 * Staggered presentation (#542; doc/visual-event-interface.md, "Migration order and acceptance",
 * step 5, and doc/game-architecture.md, "Visual-event scheduler and game-time units (#541)").
 *
 * A stagger is one presentation decision: an ordered sequence of events that starts the first at
 * once and each later one a fixed number of game-time units after the one before. Rack pulses,
 * activations read left to right, are the motivating case; the mechanism knows nothing about racks,
 * passives or scoring, so any ordered sequence can use it.
 *
 * - **One scope owns the whole sequence.** The caller passes the scope it already created — an
 *   action phase, a flight, a narration — so completion and cancellation compose with the work
 *   around it instead of adding a second queue. Children can overlap; the owning scope settles only
 *   when the last of them has.
 * - **All or nothing.** Admission goes through `scheduleBatch`, so a sequence that cannot fit is
 *   rejected whole and leaves no partial admission behind. A caller that gets `accepted: false`
 *   decides what to do (its own registered fallback); this module never silently drops an event or
 *   admits half a stagger.
 * - **Times are the caller's, in units.** The origin is captured once, so a late frame or a
 *   delayed dispatch keeps every child's *scheduled* start rather than compressing the sequence.
 * - **No model access.** Payloads are the caller's already-captured data; nothing here reads the
 *   run, mutates state, draws random numbers or holds input back.
 */
import {
  type EventDescription,
  type EventHandle,
  type ScopeHandle,
  type VisualScheduler,
} from "./scheduler";

/** Game-time units between one staggered event and the next, unless configured otherwise. */
export const staggerSpacingUnits = 2;

export type StaggerOptions = {
  /** Units between consecutive events; omitted, `staggerSpacingUnits`. */
  spacingUnits?: number;
};

/**
 * One event in a stagger, without its time: the caller supplies what to present, and this module
 * owns when it starts. The fields are the same ones `EventDescription` uses.
 */
export type StaggerStep = Pick<EventDescription, "handler" | "payload">;

export type StaggerAdmission =
  | { accepted: true; handles: readonly EventHandle[] }
  | { accepted: false; reason: string };

/**
 * Schedule `steps` in order: the first immediate, each later one `spacingUnits` after its
 * predecessor. Absolute due times are used rather than per-child delays, so the whole sequence has
 * one captured origin and cannot drift as the queue advances.
 */
export function staggerEvents(
  scheduler: VisualScheduler,
  scope: ScopeHandle,
  originUnits: number,
  steps: readonly StaggerStep[],
  options: StaggerOptions = {},
): StaggerAdmission {
  const spacing = options.spacingUnits ?? staggerSpacingUnits;
  if (!Number.isFinite(spacing) || spacing < 0)
    return { accepted: false, reason: `invalid spacing: ${spacing}` };
  if (!Number.isFinite(originUnits))
    return { accepted: false, reason: `invalid origin: ${originUnits}` };
  return scheduler.scheduleBatch(
    scope,
    steps.map((step, index) => ({
      handler: step.handler,
      payload: step.payload,
      dueUnits: originUnits + index * spacing,
      originUnits,
    })),
  );
}

/** Where a step's start falls, in units, for a caller that needs the same arithmetic (#542). */
export const staggeredStartUnits = (
  originUnits: number,
  index: number,
  spacingUnits: number = staggerSpacingUnits,
): number => originUnits + index * spacingUnits;
