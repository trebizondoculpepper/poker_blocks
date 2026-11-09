/**
 * Balance config validation (doc/game.md, "Shop rules"). Each tuning number lives on the
 * definition it belongs to (a passive's `shop` balance is on its definition), so nothing keeps
 * a side table keyed by identity. This module checks those numbers in one place, and
 * `balance.test.ts` runs the check, so a bad entry fails CI rather than a run.
 *
 * Base prices are fixed data. Anything that changes a price later (a passive that raises a sale
 * payout, say) is a modifier applied on top, never an edit to the definition.
 */
import type { MaterialDefinition } from "./materials";
import type { PassiveDefinition } from "./passives";
import { validateScoringModifier } from "./scoring-modifier";

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
