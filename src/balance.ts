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
import { passiveFrequencies, validateWeightCurve } from "./offer-weights";
import { materialUnlockRound, materialsNamedBy } from "./offer-eligibility";

/** Shared defaults for the base game; a different dealer may override its hand size. */
export const gameTuning = {
  baseHandSize: 6,
  /**
   * Coins a new card costs above its material's base price, by rank (#143): number cards
   * nothing, court cards 1, aces 2.
   */
  cardRankSurcharge: { A: 2, J: 1, Q: 1, K: 1 } as Readonly<Partial<Record<string, number>>>,
} as const;

/** A new card's shop price: its material's base price plus its rank's surcharge (#143). */
export function cardOfferPrice(rank: string, material: { shop?: { basePrice: number } }): number {
  return (material.shop?.basePrice ?? Number.NaN) + (gameTuning.cardRankSurcharge[rank] ?? 0);
}

/** Stage target numbers live together here; stage order supplies the rates into each stage. */
export type StageTargetBalance<Kind extends string> = {
  readonly openingTarget: number;
  readonly stages: readonly { readonly kind: Kind; readonly rateInto: number }[];
};

export const stageTargetBalance = {
  openingTarget: 300,
  stages: [
    { kind: "stage-1", rateInto: 1.25 },
    { kind: "stage-2", rateInto: 1.75 },
    { kind: "boss", rateInto: 1.5 },
  ],
} as const satisfies StageTargetBalance<string>;

/** Report invalid balance data before a run begins. */
export function validateStageTargetBalance<Kind extends string>(
  balance: StageTargetBalance<Kind>,
): string[] {
  const errors: string[] = [];
  if (!Number.isSafeInteger(balance.openingTarget) || balance.openingTarget < 1)
    errors.push("opening target must be a positive whole number");
  if (balance.stages.length === 0) errors.push("stage sequence must not be empty");
  const kinds = balance.stages.map(({ kind }) => kind);
  if (new Set(kinds).size !== kinds.length) errors.push("stage kinds must be unique");
  for (const stage of balance.stages) {
    if (!Number.isFinite(stage.rateInto) || stage.rateInto < 1)
      errors.push(`${stage.kind}: rate must be finite and at least 1`);
  }
  if (errors.length) return errors;
  let target = balance.openingTarget;
  for (let step = 1; step <= balance.stages.length; step++) {
    target = Math.round(target * balance.stages[step % balance.stages.length].rateInto);
    if (!Number.isSafeInteger(target) || target < 1) {
      errors.push("stage target must remain a positive safe integer after rounding");
      break;
    }
  }
  return errors;
}

/** Everything wrong with these passives' shop balance; retired passives need none. */
export function validatePassiveBalance(definitions: readonly PassiveDefinition[]): string[] {
  return definitions.flatMap((definition) => {
    const { id, shop, retired } = definition;
    if (retired) return [];
    if (!shop) return [`${id}: no shop balance`];
    return [
      ...(Number.isSafeInteger(shop.basePrice) && shop.basePrice >= 1
        ? []
        : [`${id}: base price must be a positive whole number of coins`]),
      ...(Number.isSafeInteger(shop.unlockRound) && shop.unlockRound >= 1
        ? []
        : [`${id}: unlock round must be a positive whole number`]),
      ...materialsNamedBy(definition)
        .filter((material) => shop.unlockRound < materialUnlockRound(material))
        .map((material) => `${id}: unlocks before ${material.id}, which it names`),
      ...(passiveFrequencies.has(shop.frequency)
        ? validateWeightCurve(id, passiveFrequencies.get(shop.frequency))
        : [`${id}: no frequency curve named ${shop.frequency}`]),
    ];
  });
}

/** Everything wrong with these materials' scoring modifiers (#141); a neutral one needs none. */
export function validateMaterialBalance(definitions: readonly MaterialDefinition[]): string[] {
  return definitions.flatMap(({ id, scoringModifier, handReward, shop }) => [
    ...validateScoringModifier(id, scoringModifier),
    ...(handReward === undefined ||
    (Number.isSafeInteger(handReward.coinsPerCard) && handReward.coinsPerCard >= 0)
      ? []
      : [`${id}: hand reward must be a nonnegative safe integer`]),
    ...(shop === undefined || (Number.isSafeInteger(shop.basePrice) && shop.basePrice >= 1)
      ? []
      : [`${id}: base price must be a positive whole number of coins`]),
    ...(shop ? validateWeightCurve(id, shop.weights) : []),
  ]);
}
