/**
 * How a released shop offer settles (#1206; doc/drop-settlement.md, "Ownership and protocol"):
 * the shop-offer drag source's adoption of source-settled drop outcomes, kept apart from the
 * DOM wiring so its protocol paths can be checked directly.
 *
 * - **The source's settlement.** Each release gets a gesture-owned handle whose synchronous
 *   return puts the offer back in its slot, unsold, only while the shop still displays it, and
 *   closes once. A stale or disposed source fails without partial change.
 * - **A registered release target** under the pointer (a target leased to the shop, such as a
 *   return-then-act Continue, #1148) answers a typed outcome, dispatched with that settlement: a
 *   requested return puts the offer back unsold before the target acts, never a purchase.
 * - **Otherwise the ordinary purchase**: over its purchase target, `buy` decides as before,
 *   through the transitional compatibility adapter; a refusal, a cancelled drag, a burning stock
 *   or a release elsewhere returns the offer.
 */
import {
  booleanOutcome,
  createSettlementHandle,
  dispatchDropOutcome,
  type DropOutcome,
  type DropResult,
} from "./drop-outcomes";

/** A target leased to the shop that answers a released offer with a typed outcome. */
export type OfferReleaseTarget = {
  /** Whether a release at this point is over it. */
  contains(clientX: number, clientY: number): boolean;
  outcome(generation: number): DropOutcome;
};

export type OfferRelease = {
  generation: number;
  canceled: boolean;
  /** The stock is burning out: nothing can be bought. */
  inert: boolean;
  /** The registered target under the pointer, if any. */
  target: OfferReleaseTarget | null;
  /** Whether the pointer is over one of this offer's purchase targets. */
  onPurchaseTarget: boolean;
};

export type OfferReleaseHost = {
  /** Whether the shop still displays this offer, so it can be put back. */
  owns(): boolean;
  /** Put the offer back in its slot (it flies back), unsold. */
  putBack(): void;
  /** Buy it: true when the purchase committed. */
  buy(): boolean;
  /** Present a committed purchase (its flight to the destination). */
  purchased(): void;
};

export function settleOfferRelease(host: OfferReleaseHost, release: OfferRelease): DropResult {
  let returnAsked = false;
  const settlement = createSettlementHandle(release.generation, () => {
    returnAsked = true;
    if (!host.owns()) return false;
    host.putBack();
    return true;
  });
  if (release.canceled || release.inert) {
    settlement.close();
    host.putBack();
    return "returned";
  }
  const outcome = release.target
    ? release.target.outcome(release.generation)
    : booleanOutcome(release.onPurchaseTarget && host.buy(), release.generation);
  const result = dispatchDropOutcome(outcome, settlement);
  settlement.close();
  // A purchase flies to its destination; a refusal returns the offer (the shop's refusal is its
  // return); a requested return has already put it back; one that failed was reported once by
  // the target's own owner.
  const transfers: Record<DropResult, () => void> = {
    transferred: () => (release.target ? host.putBack() : host.purchased()),
    refused: () => (returnAsked ? undefined : host.putBack()),
    returned: () => undefined,
    settled: () => undefined,
  };
  transfers[result]();
  return result;
}
