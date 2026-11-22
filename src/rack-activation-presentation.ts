/**
 * Installed items' activation feedback, staggered in rack order (#540; doc/game-architecture.md,
 * "`staggerEvents`" and "Today's scheduling", doc/visual-event-interface.md, "Migration order and
 * acceptance" step 5).
 *
 * A line's committed activations arrive in left-to-right rack order, and each installed item's
 * pulse starts a fixed spacing after the one before: the first at once, the rest two game-time
 * units apart (≈133.333 ms), from one captured origin so a late frame or a delayed dispatch never
 * compresses the sequence. Pulses overlap freely and nothing waits for the one before it. This
 * module never reads the model, rerolls, spends a charge or holds input back.
 *
 * - **One captured order.** `captureActivationOrder` asks the host which committed sources it
 *   presents, once, when the play commits. That same order later schedules the pulses and places
 *   each activation's label, so a later reorder or removal cannot move an old play's feedback and
 *   a label can never drift away from its own pulse.
 * - **The host decides what it shows.** A source that isn't an installed item (a card's own rules)
 *   is not in the captured order at all, so it can't consume a spacing slot and delay the items
 *   after it. A source that leaves the rack afterwards keeps its slot: its own pulse omits itself,
 *   the declared policy for cosmetic feedback whose mount has gone, and later pulses keep their
 *   captured times.
 * - **Its own scope per line.** Cancelling on a reset or a scene exit stops only the starts that
 *   have not happened yet, so an old run's pulses never reach a new one.
 */
import { rackActivationPulse } from "./rack-pulses";
import { staggerEvents, staggerSpacingUnits, type StaggerStep } from "./visual-events/stagger";
import { unitMs, type ScopeHandle, type VisualScheduler } from "./visual-events/scheduler";

/**
 * What a host that shows installed items' pulses offers this module: whether it presents a given
 * committed source. It never asks what kind of item the source is.
 */
export type ActivationPresentationHost = {
  /** Whether this host shows a pulse for the committed source. */
  presents(this: void, sourceId: string): boolean;
};

/** The committed sources this host presents, in order, each once (its first appearance wins). */
export function captureActivationOrder(
  committedSourceIds: readonly string[],
  host: ActivationPresentationHost,
): string[] {
  const order: string[] = [];
  for (const sourceId of committedSourceIds)
    if (host.presents(sourceId) && !order.includes(sourceId)) order.push(sourceId);
  return order;
}

/**
 * Where the `index`th captured activation's feedback starts, in game-time units after its line:
 * the first at once, each later one a spacing after the one before.
 */
export const activationOffsetUnits = (
  index: number,
  spacingUnits: number = staggerSpacingUnits,
): number => Math.max(0, index) * spacingUnits;

/**
 * Schedule a captured order's pulses from `originUnits`, through the registered
 * `rack.activationPulse` handler. The order is scheduled exactly as captured, so an item that
 * has since left the rack leaves its slot empty rather than pulling later pulses earlier.
 */
export function presentActivationOrder(
  scheduler: VisualScheduler,
  order: readonly string[],
  originUnits: number,
  options: { spacingUnits?: number; parent?: ScopeHandle | null } = {},
): ScopeHandle | null {
  if (!order.length) return null;
  const steps: StaggerStep[] = order.map((sourceId) => ({
    handler: rackActivationPulse,
    payload: { sourceId },
  }));
  const admitted = staggerEvents(scheduler, options.parent ?? null, originUnits, steps, {
    spacingUnits: options.spacingUnits,
  });
  // Optional feedback: a sequence that cannot be admitted is simply not shown.
  return admitted.accepted ? admitted.scope : null;
}

/** The line's own start on the presentation clock, in units. */
export const lineOriginUnits = (scheduler: VisualScheduler): number => scheduler.nowMs / unitMs;

/**
 * The sequences currently scheduled, so a reset or a scene exit cancels what has not started yet:
 * an old run's pulses can never appear on a new one.
 */
export function createActivationSequences(scheduler: VisualScheduler) {
  const running = new Set<ScopeHandle>();
  return {
    /** Present one line's captured order from `originUnits`, remembering it until it settles. */
    present(
      order: readonly string[],
      originUnits: number,
      options: { spacingUnits?: number; parent?: ScopeHandle | null } = {},
    ): void {
      const scope = presentActivationOrder(scheduler, order, originUnits, options);
      if (!scope) return;
      running.add(scope);
      scheduler.observe(scope, () => running.delete(scope));
    },
    /** Cancel every sequence still scheduled: nothing pending in one starts afterwards. */
    reset(): void {
      const scopes = Array.from(running);
      running.clear();
      for (const scope of scopes) scheduler.cancel(scope);
    },
    /** How many sequences are still to settle. */
    get pending(): number {
      return running.size;
    },
  };
}

export type ActivationSequences = ReturnType<typeof createActivationSequences>;
