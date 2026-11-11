/**
 * A card's look (#376): its material's definition, adjusted by any of the card's traits that
 * change how it is drawn. Each adjuster is registered under the trait it reads (cooking's
 * `doneness` browns meat), so drawing code asks for the look and never names a trait or a
 * material. Presentation only: the card's state decides the look, never the reverse.
 */
import { Registry } from "./core/registry";
import type { CardBlock } from "./cards";
import { getMaterialDefinition, materialOf, type MaterialDefinition } from "./materials";

export type CardLookAdjuster = (
  definition: MaterialDefinition,
  value: unknown,
  card: CardBlock,
) => MaterialDefinition;

export const cardLookAdjusters = new Registry<CardLookAdjuster>("card look adjuster");

/** The definition a card is drawn from: its material's, with its traits' adjustments. */
export function cardLook(card: CardBlock): MaterialDefinition {
  const traits = card.traits as Record<string, unknown>;
  return cardLookAdjusters
    .names()
    .filter((name) => traits[name] !== undefined)
    .reduce(
      (definition, name) => cardLookAdjusters.get(name)(definition, traits[name], card),
      getMaterialDefinition(materialOf(card)),
    );
}
