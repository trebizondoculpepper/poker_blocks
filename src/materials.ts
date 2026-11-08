import { cardName, standardDeck, type CardBlock } from "./cards";
import { inspectable } from "./traits/inspectable";

/** Visual prototypes for the materials room. Gameplay effects come later. */
export const blockMaterials = [
  "paper",
  "wood",
  "steel",
  "glass",
  "prismatic",
  "gold",
  "terracotta",
  "ice",
  "meat",
] as const;
export type BlockMaterial = (typeof blockMaterials)[number];

export const materialNames: Record<BlockMaterial, string> = {
  paper: "Paper",
  wood: "Wood",
  steel: "Steel",
  glass: "Glass",
  prismatic: "Prismatic Glass",
  gold: "Gold",
  terracotta: "Terracotta",
  ice: "Ice",
  meat: "Meat",
};

export function materialOf(block: CardBlock): BlockMaterial {
  return block.traits.material?.kind ?? "paper";
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let next = Math.imul(value ^ (value >>> 15), 1 | value);
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

/** Give every standard card one stable visual material for this dev run. */
export function makeDevDeck(seed: number): readonly CardBlock[] {
  const random = seededRandom(seed);
  const assignments = standardDeck.map((_, index) => blockMaterials[index % blockMaterials.length]);
  for (let index = assignments.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [assignments[index], assignments[other]] = [assignments[other], assignments[index]];
  }
  return standardDeck.map((card, index) => {
    const kind = assignments[index];
    return {
      ...card,
      traits: {
        ...card.traits,
        material: { kind },
        inspectable: inspectable(`${cardName(card.traits.identity)} · ${materialNames[kind]}`),
      },
    };
  });
}
