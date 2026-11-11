/**
 * What an installed passive sells for (issue #103). The default policy is half the passive's
 * base purchase price from the balance config, scaled by the share of its uses left (an item
 * that wears out, #390; a passive without `limitedUse` keeps all of it), rounded down, with a
 * minimum of 1 coin: a transmogrifier bought for 8 resells for 4 unused, 2 with one use left. A run
 * may add **resale modifiers**: each receives the payout so far and the sale, and returns a new
 * payout, in order. This is the extension seam for future passives that change sale payouts;
 * the sale transaction and its drop target never compute a price themselves.
 */
import type { PassiveBlock } from "./passives";

/** What a resale modifier knows about the sale. */
export type ResaleContext = {
  passive: PassiveBlock;
  /** The passive's configured base purchase price (no modifiers). */
  basePrice: number;
};

/** Changes a sale payout: returns the new payout given the payout so far. */
export type ResaleModifier = (payout: number, sale: ResaleContext) => number;

/**
 * The default payout for a base price: half, times the share of uses left (1 when it doesn't
 * wear out), rounded down, at least 1 coin.
 */
export function defaultResale(basePrice: number, usesLeft = 1, totalUses = 1): number {
  if (!Number.isFinite(basePrice) || basePrice < 0) throw new Error("bad base price");
  if (!(totalUses > 0) || usesLeft < 0 || usesLeft > totalUses) throw new Error("bad uses");
  return Math.max(1, Math.floor((basePrice * 0.5 * usesLeft) / totalUses));
}

/**
 * The payout for selling this passive: the default from its base price, then each modifier in
 * order. Null when the result is not a non-negative whole number of coins, so a bad modifier
 * can never corrupt the balance.
 */
export function resaleValue(
  passive: PassiveBlock,
  modifiers: readonly ResaleModifier[] = [],
): number | null {
  try {
    const basePrice = passive.traits.priced?.basePrice;
    if (basePrice === undefined) return null;
    const sale = { passive, basePrice };
    const payout = modifiers.reduce(
      (value, modify) => modify(value, sale),
      defaultResale(
        sale.basePrice,
        passive.traits.limitedUse?.uses,
        passive.traits.limitedUse?.total,
      ),
    );
    return Number.isSafeInteger(payout) && payout >= 0 ? payout : null;
  } catch {
    return null;
  }
}
