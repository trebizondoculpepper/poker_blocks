/**
 * An installed item's activation pulse as scheduler work (#540; doc/game-architecture.md, "Activation
 * pulse" and "`staggerEvents`", doc/visual-event-interface.md, "Migration order and acceptance" step 5).
 *
 * One handler, one event: an item's own pulse was already decided when the play committed, so this
 * only starts it at its scheduled time and settles when it ends. It names no rack, item, category or
 * mode: the host that owns the token and its look is the service, found by contract, and the pulse's
 * length, colour and sound come from the item's own composed `activationPulse`.
 *
 * - **Item-owned.** Each item's look and sound are its own; this handler asks its host to start one
 *   installed item's pulse, so no event here knows what the item is.
 * - **Late start.** Started after its interval would already have ended, it shows nothing rather
 *   than a burst; the host reports that by returning no effect.
 * - **Missing host or item.** Nothing to draw on, so it settles at once: the declared omit policy
 *   for cosmetic feedback whose mount has gone.
 */
import { visualHandlers, type EffectHandle } from "./visual-events/scheduler";

/** The registered handler key for one installed item's activation pulse. */
export const rackActivationPulse = "rack.activationPulse";

/**
 * What the handler shows through: the host holding installed items' tokens, which owns each
 * item's pulse look, its sound and its mount.
 */
export type RackPulseServices = {
  rackPulses?: {
    /**
     * Begin one installed item's pulse, presented as of `fromMs` (its scheduled start on the
     * presentation clock) while the scheduler's clock reads `nowMs`. Null when there is nothing
     * to show: the item has left the rack, or its pulse would already have ended.
     */
    pulse(sourceId: string, fromMs: number, nowMs: number): EffectHandle | null;
  };
};

visualHandlers.register(rackActivationPulse, (raw, context): "done" | EffectHandle => {
  const { sourceId } = raw as { sourceId: string };
  const host = (context.services as RackPulseServices | undefined)?.rackPulses;
  if (!host) return "done";
  return host.pulse(sourceId, context.scheduledAtMs, context.nowMs) ?? "done";
});
