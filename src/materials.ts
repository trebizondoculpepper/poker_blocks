import { cardName, standardDeck, type CardBlock } from "./cards";
import { inspectable } from "./traits/inspectable";
import type { WeightCurve } from "./offer-weights";
import type { EventRule } from "./event-rules";
import { scoringModifierRules, type ScoringModifier } from "./scoring-modifier";
import type { TokenEffectConfig } from "./passive-activation-effects";
import type { SoundEffectId } from "./audio/sfx-registry";

/** A particle trail: a registered effect (src/attract-trails.ts) and its configuration. */
export type AppearanceTrail = {
  effect: string;
  /** Particles emitted per second while the block moves. */
  rate: number;
  /** Seconds each particle lives. */
  life: number;
  /** A particle's size in world units. */
  size: number;
  /** How far from the block's centre a particle may start. */
  spread: number;
};

/** Data on each material definition, consumed by reusable appearance handlers. */
export type MaterialDefinition = {
  id: string;
  name: string;
  traits: { transparent?: Record<string, never> };
  /**
   * How the material changes a line it contributes to (#141). Left out until the material's
   * scoring is designed: meat, fire and ice wait on #104–#106.
   */
  scoringModifier?: ScoringModifier;
  /** Coins per card still held at settlement, on both a win and a loss. */
  handReward?: { coinsPerCard: number };
  /** Presentation when one of this material's scoring rules fires. */
  activation?: { effect: TokenEffectConfig; sfx: SoundEffectId };
  /**
   * What a new card of this material costs in the shop before its rank surcharge (#143). A
   * material without one is never offered.
   */
  shop?: {
    basePrice: number;
    /** Relative weight of its card offers by round; zero before the first keyframe (#145). */
    weights: WeightCurve;
  };
  appearance: {
    pattern: string;
    assembly: string;
    surface: string;
    height: string;
    ink: { red: string; black: string; onDark: boolean };
    edge: { color: number; opacity: number };
    geometry: { shape: string; segments: number; radius: number; scale: number };
    reliefScale: number;
    endGrainFaces: readonly number[];
    /**
     * Particle trails a block of this material leaves as it moves, where a scene shows them
     * (the title's attract sequence). Each names a registered trail effect and configures it.
     */
    trails?: readonly AppearanceTrail[];
    optics?: {
      tint: number;
      handIor: number;
      tableIor: number;
      handEnvironment: number;
      tableEnvironment: number;
      tableRoughness: number;
      thickness: number;
      dispersion: number;
      attenuationDistance: number;
      iridescence?: {
        flatShading: boolean;
        iridescence: number;
        iridescenceIOR: number;
        iridescenceThicknessMinimum: number;
        iridescenceThicknessMaximum: number;
      };
    };
  };
};

const lightInk = { red: "#bd3651", black: "#182d4a", onDark: false };
const darkInk = { red: "#a32536", black: "#422716", onDark: true };
const box = { shape: "box", segments: 0, radius: 0, scale: 1 };
const noEnds: readonly number[] = [];

export const materialDefinitions = [
  {
    id: "paper",
    name: "Paper",
    traits: {},
    shop: {
      basePrice: 1,
      weights: [
        [1, 4],
        [8, 0],
      ],
    },
    appearance: {
      pattern: "cardSheet",
      assembly: "sixFaces",
      surface: "cardSheet",
      height: "cardRim",
      ink: lightInk,
      edge: { color: 0x6b6c73, opacity: 0 },
      geometry: { ...box, scale: 0.985 },
      reliefScale: 2,
      endGrainFaces: noEnds,
    },
  },
  {
    id: "wood",
    name: "Wood",
    traits: {},
    shop: {
      basePrice: 3,
      weights: [
        [1, 1],
        [2, 2],
        [3, 2],
        [8, 0.25],
      ],
    },
    scoringModifier: { additive: 1 },
    activation: { effect: { id: "pulse", colour: "#c88b4c" }, sfx: "material.activate.wood" },
    appearance: {
      pattern: "timberGrain",
      assembly: "sixFaces",
      surface: "matte",
      height: "carvedTimber",
      ink: darkInk,
      edge: { color: 0x76502b, opacity: 1 },
      geometry: box,
      reliefScale: 2.5,
      endGrainFaces: [2, 3],
    },
  },
  {
    id: "steel",
    name: "Steel",
    traits: {},
    shop: {
      basePrice: 4,
      weights: [
        [2, 0.5],
        [4, 1],
      ],
    },
    scoringModifier: { multiplicative: 1.25 },
    activation: { effect: { id: "pulse", colour: "#93b5d0" }, sfx: "material.activate.steel" },
    appearance: {
      pattern: "brushedRivets",
      assembly: "brushedFaces",
      surface: "brushedMetal",
      height: "steelRelief",
      ink: { red: "#a3202f", black: "#182d4a", onDark: false },
      edge: { color: 0x303a40, opacity: 1 },
      geometry: box,
      reliefScale: 3,
      endGrainFaces: noEnds,
    },
  },
  {
    id: "prismatic",
    name: "Prismatic Crystal",
    traits: { transparent: {} },
    shop: {
      basePrice: 12,
      weights: [
        [5, 0.25],
        [6, 0.5],
      ],
    },
    scoringModifier: { exponential: 1.1 },
    activation: {
      effect: { id: "pulse", colour: "#bf8cff" },
      sfx: "material.activate.prismatic",
    },
    appearance: {
      pattern: "rainbowCrystal",
      assembly: "refractiveCrystal",
      surface: "clear",
      height: "none",
      ink: lightInk,
      edge: { color: 0xf2e8ff, opacity: 0.55 },
      geometry: { shape: "rounded", segments: 1, radius: 0.14, scale: 0.985 },
      reliefScale: 0,
      endGrainFaces: noEnds,
      trails: [{ effect: "rainbowStars", rate: 70, life: 1.8, size: 1.1, spread: 0.8 }],
      optics: {
        tint: 0xffffff,
        handIor: 2.33,
        tableIor: 2.33,
        handEnvironment: 1.6,
        tableEnvironment: 1.6,
        tableRoughness: 0.02,
        thickness: 0.9,
        dispersion: 4,
        attenuationDistance: 6,
        iridescence: {
          flatShading: true,
          iridescence: 1,
          iridescenceIOR: 1.8,
          iridescenceThicknessMinimum: 150,
          iridescenceThicknessMaximum: 900,
        },
      },
    },
  },
  {
    id: "gold",
    name: "Gold",
    traits: {},
    shop: { basePrice: 8, weights: [[4, 1]] },
    scoringModifier: { additive: 1 },
    activation: { effect: { id: "pulse", colour: "#f3c85e" }, sfx: "material.activate.gold" },
    handReward: { coinsPerCard: 2 },
    appearance: {
      pattern: "goldFoil",
      assembly: "sixFaces",
      surface: "polishedMetal",
      height: "engravedGold",
      ink: { red: "#bd3651", black: "#422716", onDark: true },
      edge: { color: 0x9c661e, opacity: 0 },
      geometry: { shape: "rounded", segments: 5, radius: 0.06, scale: 1 },
      reliefScale: 1.5,
      endGrainFaces: noEnds,
    },
  },
  {
    id: "terracotta",
    name: "Terracotta",
    traits: {},
    appearance: {
      pattern: "crackedClay",
      assembly: "sixFaces",
      surface: "matte",
      height: "clayRelief",
      ink: { red: "#bd3651", black: "#422716", onDark: true },
      edge: { color: 0x733d2b, opacity: 1 },
      geometry: box,
      reliefScale: 3,
      endGrainFaces: noEnds,
    },
  },
  {
    id: "ice",
    name: "Ice",
    traits: { transparent: {} },
    shop: {
      basePrice: 2,
      weights: [
        [3, 0.75],
        [4, 1],
      ],
    },
    appearance: {
      pattern: "frostedIce",
      assembly: "frostedBlock",
      surface: "frosted",
      height: "iceRelief",
      ink: lightInk,
      edge: { color: 0xd3f7ff, opacity: 0 },
      geometry: { ...box, scale: 0.985 },
      reliefScale: 3,
      endGrainFaces: noEnds,
    },
  },
  {
    id: "meat",
    name: "Meat",
    traits: {},
    shop: {
      basePrice: 6,
      weights: [
        [3, 0.75],
        [4, 1],
      ],
    },
    appearance: {
      pattern: "marbledFlesh",
      assembly: "sixFaces",
      surface: "matte",
      height: "none",
      ink: { red: "#bd3651", black: "#f4e9db", onDark: true },
      edge: { color: 0x6b2538, opacity: 0 },
      geometry: { shape: "rounded", segments: 3, radius: 0.09, scale: 1 },
      reliefScale: 2,
      endGrainFaces: noEnds,
    },
  },
  {
    id: "fire",
    name: "Fire",
    traits: { transparent: {} },
    shop: {
      basePrice: 4,
      weights: [
        [3, 0.75],
        [4, 1],
      ],
    },
    appearance: {
      pattern: "ironFrame",
      assembly: "flameFrame",
      surface: "iron",
      height: "frameRelief",
      ink: { red: "#6e1a1a", black: "#24282c", onDark: false },
      edge: { color: 0x2a2f34, opacity: 1 },
      geometry: { ...box, scale: 0.985 },
      reliefScale: 2.5,
      endGrainFaces: noEnds,
    },
  },
] as const satisfies readonly MaterialDefinition[];

export type BlockMaterial = (typeof materialDefinitions)[number]["id"];
export const blockMaterials: readonly BlockMaterial[] = materialDefinitions.map(({ id }) => id);
const materialRegistry = new Map<string, MaterialDefinition>(
  materialDefinitions.map((item) => [item.id, item]),
);

export function getMaterialDefinition(kind: BlockMaterial): MaterialDefinition {
  const definition = materialRegistry.get(kind);
  if (!definition) throw new Error(`Unknown material: ${kind}`);
  return definition;
}

export function materialOf(block: CardBlock): BlockMaterial {
  return block.traits.material?.kind ?? "paper";
}

/** The scoring rules a card brings with it: its material's scoring modifier, expanded. */
export function cardScoringRules(block: CardBlock): EventRule[] {
  return scoringModifierRules(getMaterialDefinition(materialOf(block)).scoringModifier);
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

/** A card made of a material: its traits, and its name in the inspector. */
export function withMaterial(card: CardBlock, definition: MaterialDefinition): CardBlock {
  return {
    ...card,
    traits: {
      ...card.traits,
      material: { kind: definition.id as BlockMaterial },
      ...definition.traits,
      inspectable: inspectable(`${cardName(card.traits.identity)} · ${definition.name}`),
    },
  };
}

/** Give every standard card one stable visual material for this dev run. */
export function makeDevDeck(seed: number): readonly CardBlock[] {
  const random = seededRandom(seed);
  const assignments = standardDeck.map(
    (_, index) => materialDefinitions[index % materialDefinitions.length],
  );
  for (let index = assignments.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [assignments[index], assignments[other]] = [assignments[other], assignments[index]];
  }
  return standardDeck.map((card, index) => withMaterial(card, assignments[index]));
}
