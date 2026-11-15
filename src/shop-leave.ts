/**
 * Leaving the shop, model first (#880; doc/outcome-presentation.md, "Effect and progression
 * sounds"). The leave commits before any presentation; the outgoing stock captured at commit
 * burns as the shop's own ghosts with its cue at the burn's start (only if something left); the
 * leave cue follows at the exit anchor, once the burn is done. A refused leave presents nothing,
 * and a new run started while the old shop burns takes over: the old leave neither cues nor
 * navigates.
 */
import type { SoundEffectId } from "./audio/sfx-registry";

export type ShopLeaveSteps = {
  /** How many offers are in stock now: what will leave if the leave commits. */
  outgoing(): number;
  /** The authoritative leave; false when refused. */
  commit(): boolean;
  /** Save the committed run. */
  save(): void;
  /** Burn the outgoing stock's ghosts; resolves when the burn is done. */
  burn(): Promise<void>;
  sound(id: SoundEffectId): void;
  /** Whether the run that left is still the current one. */
  current(): boolean;
};

/** Returns true when the caller should navigate on to the destination. */
export async function leaveShop(steps: ShopLeaveSteps): Promise<boolean> {
  const outgoing = steps.outgoing();
  if (!steps.commit()) return false;
  steps.save();
  if (outgoing > 0) steps.sound("shop.stock.burn");
  await steps.burn();
  if (!steps.current()) return false;
  steps.sound("shop.leave");
  return true;
}
