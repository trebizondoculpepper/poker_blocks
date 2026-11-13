/**
 * The shared weighted playable-card generator (#555; doc/opaque-actives.md, "Creation and
 * generation"; doc/presents.md). It makes one card from a registered distribution at the round a
 * registered progression query picks, keeping only materials a registered eligibility allows.
 * It never stocks a shop to sample one card, and nothing here names a round, a material or a
 * Present: each of those choices is a registry entry chosen by configuration.
 *
 * Randomness comes only from the caller's seeded session stream, in a fixed order: **material,
 * then rank, then suit**, one value each. An empty eligible pool fails before any draw or ID is
 * taken, so a failed generation consumes nothing.
 */
import { createCard, ranks, suits, type CardBlock } from "./cards";
import { Registry } from "./core/registry";
import { materialDefinitions, withMaterial, type MaterialDefinition } from "./materials";
import { drawWeighted, weightAt } from "./offer-weights";

/** Each material a distribution can produce, and its weight at a round. */
export type CardDistribution = (
  round: number,
) => { material: MaterialDefinition; weight: number }[];
export const cardDistributions = new Registry<CardDistribution>("card distribution");

/** The round whose table a generation uses, from the round it happens in. */
export type ProgressionQuery = (round: number, config: unknown) => number;
export const progressionQueries = new Registry<ProgressionQuery>("progression query");

/** Whether a material may be produced for this kind of generation. */
export type GenerationEligibility = (material: MaterialDefinition) => boolean;
export const generationEligibilities = new Registry<GenerationEligibility>(
  "generation eligibility",
);

// The shop's playable-card table: each material's shop weight curve at that round.
cardDistributions.register("shopPlayableCards", (round) =>
  (materialDefinitions as readonly MaterialDefinition[]).map((material) => ({
    material,
    weight: material.shop ? weightAt(material.shop.weights, round) : 0,
  })),
);

// The next round's table; past a configured final round, that final round's. Weight curves hold
// their last value beyond their last point, so with no final round this is simply round + 1.
progressionQueries.register("nextRound", (round, raw) => {
  const { finalRound } = (raw ?? {}) as { finalRound?: number };
  return finalRound === undefined ? round + 1 : Math.min(round + 1, finalRound);
});
progressionQueries.register("currentRound", (round) => round);

// Every material a shop could sell.
generationEligibilities.register("any", () => true);
// A hidden payload: only materials that allow it (Paper doesn't, doc/presents.md).
generationEligibilities.register("payload", (material) => material.payloadEligible ?? true);

export type CardGeneration = {
  distribution: string;
  progression: string;
  progressionConfig?: unknown;
  eligibility: string;
};

export class EmptyGenerationPool extends Error {
  constructor(round: number) {
    super(`no eligible material to generate a card from at round ${round}`);
    this.name = "EmptyGenerationPool";
  }
}

/**
 * One generated card, given the round it is made in. Throws `EmptyGenerationPool`, having drawn
 * nothing and allocated nothing, when no eligible material has weight.
 */
export function generateCard(
  generation: CardGeneration,
  round: number,
  random: () => number,
  allocate: () => string,
): CardBlock {
  const table = progressionQueries.get(generation.progression)(round, generation.progressionConfig);
  const eligible = generationEligibilities.get(generation.eligibility);
  const pool = cardDistributions
    .get(generation.distribution)(table)
    .filter(({ material, weight }) => weight > 0 && eligible(material));
  if (!pool.length) throw new EmptyGenerationPool(table);
  const { material } = drawWeighted(pool, ({ weight }) => weight, random)!;
  const rank = ranks[Math.floor(random() * ranks.length)]!;
  const suit = suits[Math.floor(random() * suits.length)]!;
  return withMaterial(createCard({ rank, suit }, allocate()), material);
}
