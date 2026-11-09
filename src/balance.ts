/**
 * Shared game tuning and balance validation (doc/game.md, "Shop rules"). Values that belong
 * to a specific definition (such as a passive's shop price) stay on that definition, so
 * nothing keeps a side table keyed by identity. This module checks those values in one place.
 *
 * Base prices are fixed data. Anything that changes a price later (a passive that raises a sale
 * payout, say) is a modifier applied on top, never an edit to the definition.
 */
import type { MaterialDefinition } from "./materials";
import type { PassiveDefinition } from "./passives";
import { validateScoringModifier } from "./scoring-modifier";

/** Shared defaults for the base game; a different dealer may override its hand size. */
export const gameTuning = {
  baseHandSize: 6,
} as const;

/** Everything wrong with these passives' shop balance; retired passives need none. */
export function validatePassiveBalance(definitions: readonly PassiveDefinition[]): string[] {
  return definitions.flatMap(({ id, shop, retired }) => {
    if (retired) return [];
    if (!shop) return [`${id}: no shop balance`];
    return [
      ...(Number.isSafeInteger(shop.basePrice) && shop.basePrice >= 1
        ? []
        : [`${id}: base price must be a positive whole number of coins`]),
      ...(Number.isSafeInteger(shop.unlockRound) && shop.unlockRound >= 1
        ? []
        : [`${id}: unlock round must be a positive whole number`]),
    ];
  });
}

/** Everything wrong with these materials' scoring modifiers (#141); a neutral one needs none. */
export function validateMaterialBalance(definitions: readonly MaterialDefinition[]): string[] {
  return definitions.flatMap(({ id, scoringModifier }) =>
    validateScoringModifier(id, scoringModifier),
  );
}
