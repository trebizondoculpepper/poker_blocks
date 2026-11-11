/**
 * Transmogrifiers (#388, split from #384): limited-use Items-rack items that permanently change
 * a card's material. One per material, generated from material configuration, never listed by
 * hand. Applying one to a card is #389; resale by remaining uses is #390; its look is #391.
 *
 * - **Which materials:** every gameplay material with a transmogrifier price. By default the
 *   price is twice the material's shop base price (no rank surcharge) and it is drawn by the
 *   material's own weight curve, so it unlocks with the material. A material may override
 *   either through its `transmogrifier` data (paper, never sold as a card, sets both). A
 *   material with neither a shop price nor an override has no transmogrifier: no price is
 *   invented for it.
 * - **The item:** a passive block of a generated definition (`transmogrifier.<material>`), with
 *   no event rules and no passive shop balance, so the ordinary passive draw never offers it.
 *   It carries `limitedUse` (uses left of total) and `priced` (what it cost: the resale basis).
 * - **The shop:** `transmogrifierSlots` dedicated offers (default 1), on top of the ordinary
 *   stock, each drawn by weight from the transmogrifiers unlocked this round.
 */
import { materialDefinitions, type BlockMaterial, type MaterialDefinition } from "./materials";
import { createPassiveBlock, passiveDefinitions, type PassiveBlock } from "./passives";
import { weightAt, type WeightCurve } from "./offer-weights";
import { blockMaterials } from "./materials";
import { rackTraitPersistence } from "./rack-trait-persistence";
// Registers the material-block token visual (#391).
import "./visual/material-token";

/** Uses a new transmogrifier has (#384). */
export const defaultTransmogrifierUses = 2;
/** Its price is this many times its material's shop base price (#384). */
export const transmogrifierPriceFactor = 2;

const prefix = "transmogrifier.";

/** The definition id of a material's transmogrifier. */
export const transmogrifierId = (material: BlockMaterial): string => `${prefix}${material}`;

/** A transmogrifier's balance: its price and the curve its offers are drawn by. */
export function transmogrifierBalance(
  material: MaterialDefinition,
): { price: number; weights: WeightCurve } | null {
  const own = material.transmogrifier;
  const price =
    own?.price ?? (material.shop ? material.shop.basePrice * transmogrifierPriceFactor : undefined);
  const weights = own?.weights ?? material.shop?.weights;
  return price === undefined || weights === undefined ? null : { price, weights };
}

/** Every material that has a transmogrifier, with its balance. */
export function transmogrifierMaterials(): {
  material: MaterialDefinition;
  price: number;
  weights: WeightCurve;
}[] {
  return (materialDefinitions as readonly MaterialDefinition[]).flatMap((material) => {
    const balance = transmogrifierBalance(material);
    return balance ? [{ material, ...balance }] : [];
  });
}

// One generated definition per material, so the rack, inspector and saves resolve it by id.
for (const { material, price, weights } of transmogrifierMaterials())
  passiveDefinitions.register(transmogrifierId(material.id as BlockMaterial), {
    id: transmogrifierId(material.id as BlockMaterial),
    name: `${material.name} transmogrifier`,
    symbol: "⟳",
    description: `Turns a card in your hand or on the table to ${material.name}, keeping its rank and suit. Uses: ${defaultTransmogrifierUses}.`,
    traitId: "passive.event-rules",
    categoryTrait: { effectCategory: {} },
    eventRules: [],
    // Drawn as a plain block of its material: no rank or suit (#391).
    visual: { builder: "materialBlock", config: { material: material.id } },
    // Stocked only by its dedicated slots: the "dedicated" curve never draws it as a passive.
    shop: {
      basePrice: price,
      unlockRound: weights.find(([, weight]) => weight > 0)?.[0] ?? 1,
      frequency: "dedicated",
    },
  });

/** A new transmogrifier item for `material`, at `price`, with all its uses. */
export function createTransmogrifier(
  material: BlockMaterial,
  id: string,
  price: number,
  uses = defaultTransmogrifierUses,
  total = defaultTransmogrifierUses,
): PassiveBlock {
  const block = createPassiveBlock(transmogrifierId(material), id);
  return {
    ...block,
    traits: {
      ...block.traits,
      priced: { basePrice: price },
      limitedUse: { uses, total },
      transmogrifier: { material },
    },
  };
}

/** How many offers a round's shop draws for transmogrifiers: their weights, by material. */
export function transmogrifierWeights(
  round: number,
): { material: BlockMaterial; price: number; weight: number }[] {
  return transmogrifierMaterials().map(({ material, price, weights }) => ({
    material: material.id as BlockMaterial,
    price,
    weight: weightAt(weights, round),
  }));
}

// A transmogrifier's material is saved with it in the rack (#388).
rackTraitPersistence.register("transmogrifier", {
  save: (value) => ({ ...(value as object) }),
  restore: (saved) => {
    const material = (saved as { material?: unknown })?.material;
    if (!blockMaterials.includes(material as BlockMaterial))
      throw new Error("bad transmogrifier material");
    return { material: material as BlockMaterial };
  },
});
