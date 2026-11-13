/**
 * Composable starting-deck builders (#827; doc/deck-builders.md). A deck-builder definition is an
 * ordered list of configured operations; the runner dispatches each by name through
 * `deckBuilderOperations`, never by mode, material or builder identity. Each operation takes the
 * context (the cards built so far and the builder's own seeded stream) and returns the next.
 * Operations create cards only: they move no live run card, change no shared deck, install no
 * listener and make no sound. Anything invalid throws `DeckBuilderError` and no deck is
 * published.
 *
 * All randomness comes from one stream seeded once per build, consumed in operation order, so a
 * seed and configuration rebuild the same deck. Balanced assignment keeps `makeDevDeck`'s exact
 * semantics (cyclic, then a seeded shuffle of assignments); it is not weighted sampling.
 */
import { standardDeck, type CardBlock } from "./cards";
import { Registry } from "./core/registry";
import { shuffleCards } from "./deal";
import {
  getMaterialDefinition,
  materialPools,
  seededRandom,
  withMaterial,
  type BlockMaterial,
  type MaterialDefinition,
} from "./materials";
import { drawWeighted } from "./offer-weights";

export type DeckBuilderContext = { cards: readonly CardBlock[]; random: () => number };
export type DeckBuilderOperation = (
  context: DeckBuilderContext,
  config: unknown,
) => DeckBuilderContext;
export type DeckBuilderStep = { operation: string; config?: unknown };

export const deckBuilderOperations = new Registry<DeckBuilderOperation>("deck builder operation");

export class DeckBuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeckBuilderError";
  }
}

/** Build a deck: every operation in order, from an empty list and a stream seeded with `seed`. */
export function buildDeck(steps: readonly DeckBuilderStep[], seed: number): readonly CardBlock[] {
  const unknown = steps.filter(({ operation }) => !deckBuilderOperations.has(operation));
  if (unknown.length)
    throw new DeckBuilderError(
      `unknown deck builder operation(s): ${unknown.map((s) => s.operation).join(", ")}`,
    );
  const built = steps.reduce(
    (context, { operation, config }) => deckBuilderOperations.get(operation)(context, config),
    { cards: [] as readonly CardBlock[], random: seededRandom(seed) },
  ).cards;
  if (new Set(built.map(({ id }) => id)).size !== built.length)
    throw new DeckBuilderError("the built deck has duplicate card IDs");
  return built;
}

const requireCards = (context: DeckBuilderContext, operation: string) => {
  if (!context.cards.length) throw new DeckBuilderError(`${operation} needs cards to work on`);
};

const definitionOf = (material: unknown): MaterialDefinition => {
  if (typeof material !== "string") throw new DeckBuilderError("a material reference is required");
  return getMaterialDefinition(material as BlockMaterial);
};

// The 52 standard rank/suit templates, appended in their usual order.
deckBuilderOperations.register("standardTemplates", (context) => ({
  ...context,
  cards: [...context.cards, ...standardDeck],
}));

// Every card made of one configured material.
deckBuilderOperations.register("assignUniform", (context, raw) => {
  requireCards(context, "assignUniform");
  const definition = definitionOf((raw as { material?: unknown } | undefined)?.material);
  return { ...context, cards: context.cards.map((card) => withMaterial(card, definition)) };
});

// A pool's materials dealt cyclically across the cards, then the assignments shuffled with the
// builder's stream: exactly `makeDevDeck`'s semantics and random consumption.
deckBuilderOperations.register("assignBalanced", (context, raw) => {
  requireCards(context, "assignBalanced");
  const { pool = "gameplay" } = (raw ?? {}) as { pool?: string };
  const materials = materialPools.get(pool)();
  if (!materials.length) throw new DeckBuilderError(`material pool "${pool}" is empty`);
  const assignments = context.cards.map((_, index) => materials[index % materials.length]!);
  for (let index = assignments.length - 1; index > 0; index--) {
    const other = Math.floor(context.random() * (index + 1));
    [assignments[index], assignments[other]] = [assignments[other]!, assignments[index]!];
  }
  return {
    ...context,
    cards: context.cards.map((card, index) => withMaterial(card, assignments[index]!)),
  };
});

// Each card's material sampled independently by weight (probabilities, not exact counts).
deckBuilderOperations.register("assignWeighted", (context, raw) => {
  requireCards(context, "assignWeighted");
  const { weights = [] } = (raw ?? {}) as {
    weights?: readonly { material: string; weight: number }[];
  };
  if (weights.some(({ weight }) => !Number.isFinite(weight) || weight < 0))
    throw new DeckBuilderError("material weights must be finite and nonnegative");
  const total = weights.reduce((sum, { weight }) => sum + weight, 0);
  if (!(total > 0)) throw new DeckBuilderError("material weights must have a positive sum");
  const candidates = weights.map(({ material, weight }) => ({
    definition: definitionOf(material),
    weight,
  }));
  return {
    ...context,
    cards: context.cards.map((card) =>
      withMaterial(
        card,
        drawWeighted(candidates, ({ weight }) => weight, context.random)!.definition,
      ),
    ),
  };
});

// The built list permuted with the builder's stream: the same instances, a new order.
deckBuilderOperations.register("shuffle", (context) => ({
  ...context,
  cards: shuffleCards(context.cards, context.random),
}));

/** The normalised distribution a weighted step will sample from, for export alongside a run. */
export function normalisedWeights(weights: readonly { material: string; weight: number }[]) {
  const total = weights.reduce((sum, { weight }) => sum + weight, 0);
  return weights.map(({ material, weight }) => ({ material, share: weight / total }));
}
