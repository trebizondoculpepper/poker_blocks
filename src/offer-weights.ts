/**
 * How often each kind of shop offer appears (#145, doc/game.md "Unlocks and stock weights").
 * A weight curve is data: keyframes of (round, relative weight). Before its first keyframe an
 * offer is not yet unlocked (weight 0); between keyframes the weight is interpolated linearly;
 * after the last it holds. A weight of zero makes an offer ineligible. Weights are relative:
 * drawing normalises whatever is eligible.
 */
import { Registry } from "./core/registry";

/** Keyframes `[round, weight]`, rounds strictly increasing. */
export type WeightCurve = readonly (readonly [round: number, weight: number])[];

/** An offer's relative weight in a round. */
export function weightAt(curve: WeightCurve, round: number): number {
  const first = curve[0];
  if (!first || round < first[0]) return 0;
  const after = curve.findIndex(([at]) => at > round);
  if (after < 0) return curve[curve.length - 1]![1];
  const [fromRound, fromWeight] = curve[after - 1]!;
  const [toRound, toWeight] = curve[after]!;
  return fromWeight + ((toWeight - fromWeight) * (round - fromRound)) / (toRound - fromRound);
}

/** Everything wrong with a curve, prefixed with its owner's name. */
export function validateWeightCurve(owner: string, curve: WeightCurve): string[] {
  return [
    ...(curve.length ? [] : [`${owner}: a weight curve needs at least one keyframe`]),
    ...curve.flatMap(([round, weight], index) => [
      ...(Number.isSafeInteger(round) && round >= 1
        ? []
        : [`${owner}: keyframe rounds must be positive whole numbers`]),
      ...(Number.isFinite(weight) && weight >= 0 ? [] : [`${owner}: weights must be non-negative`]),
      ...(index > 0 && round <= curve[index - 1]![0]
        ? [`${owner}: keyframe rounds must increase`]
        : []),
    ]),
  ];
}

/** Frequency labels the owner agreed: common 4, uncommon 2, rare 1, absent 0. */
export const frequency = { common: 4, uncommon: 2, rare: 1, absent: 0 } as const;

/**
 * Named passive frequency curves, which a passive's shop balance names. The scoring curves
 * follow the agreed progression by scoring operation; every other passive is drawn evenly.
 */
export const passiveFrequencies = new Registry<WeightCurve>("passive frequency");
const { common, uncommon, rare, absent } = frequency;
passiveFrequencies.register("additiveScoring", [
  [1, common],
  [2, common],
  [3, rare],
  [4, rare],
  [5, uncommon],
]);
passiveFrequencies.register("multiplicativeScoring", [
  [1, rare],
  [2, rare],
  [3, common],
]);
passiveFrequencies.register("exponentialScoring", [
  [1, absent],
  [2, absent],
  [3, rare],
  [4, rare],
  [5, uncommon],
  [6, uncommon],
  [7, common],
]);
passiveFrequencies.register("even", [[1, 1]]);
/**
 * Never drawn into the ordinary passive offers: for items stocked only by their own dedicated
 * shop slots (transmogrifiers, #388).
 */
passiveFrequencies.register("dedicated", [[1, absent]]);

/** One of `items`, drawn by weight; null when nothing has a positive weight. */
export function drawWeighted<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  random: () => number,
): T | null {
  const weights = items.map(weightOf);
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) return null;
  let left = random() * total;
  for (let index = 0; index < items.length; index++) {
    left -= Math.max(0, weights[index]!);
    if (left < 0 && weights[index]! > 0) return items[index]!;
  }
  return items.findLast((_, index) => weights[index]! > 0) ?? null;
}
