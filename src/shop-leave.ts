/**
 * Leaving the shop, model first (#880; doc/outcome-presentation.md, "Effect and progression
 * sounds"). The leave commits and is saved before any presentation. Its committed `shop.left`
 * receipt is presented by the shop scene's `shopExitResponse` controller trait (the burn of the
 * captured outgoing stock and its cues); the run only waits for that required outgoing effect
 * before revealing the destination. A refused leave presents nothing, and a run started while
 * the old shop burns takes over: the old leave does not navigate.
 */
export type ShopLeaveSteps = {
  /** The authoritative leave; false when refused. */
  commit(): boolean;
  /** Save the committed run. */
  save(): void;
  /**
   * The required outgoing effect the receipt started: true when it ran to its end, false when it
   * was cut short (a quit, a new run), in which case the leave does not navigate.
   */
  outgoingDone(): Promise<boolean>;
  /** Whether the run that left is still the current one. */
  current(): boolean;
};

/** Returns true when the caller should navigate on to the destination. */
export async function leaveShop(steps: ShopLeaveSteps): Promise<boolean> {
  if (!steps.commit()) return false;
  steps.save();
  const finished = await steps.outgoingDone();
  return finished && steps.current();
}
