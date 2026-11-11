import type { ChopSettings } from "./visual/chopped-geometry";
import type { Lettering } from "./visual/lettering";
import { Registry } from "./core/registry";
import type { ContainerConfig, ContentsConfig } from "./visual/contained";
import { cardName, standardDeck, type CardBlock } from "./cards";
import { inspectable } from "./traits/inspectable";
import type { WeightCurve } from "./offer-weights";
import type { EventRule } from "./event-rules";
import { stateBonusRules } from "./state-bonuses";
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
  /** Default text font for letter and word cubes; does not affect card faces. */
  lettering?: Lettering;
  traits: { transparent?: Record<string, never> };
  /**
   * How the material sounds when blocks meet (#232). The softer of two materials meeting
   * decides the attachment sound: `hardness` orders them (higher is harder), `attach` is the
   * sound, and `character` says in words how it sounds.
   */
  acoustics: { character: string; hardness: number; attach: SoundEffectId };
  /**
   * How the material changes a line it contributes to (#141). Left out until the material's
   * scoring is designed: meat, fire and ice wait on #104–#106.
   */
  scoringModifier?: ScoringModifier;
  /**
   * Its transmogrifier's balance, where the default (twice the shop base price, drawn by the
   * material's own weight curve) does not apply or there is no shop price (#388).
   */
  transmogrifier?: { price?: number; weights?: WeightCurve };
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
    geometry: {
      shape: string;
      segments: number;
      radius: number;
      scale: number;
      /** For the `chopped` shape: its cleaver cuts and dents (src/visual/chopped-geometry.ts). */
      chop?: ChopSettings;
    };
    reliefScale: number;
    endGrainFaces: readonly number[];
    /**
     * Particle trails a block of this material leaves as it moves, where a scene shows them
     * (the title's attract sequence). Each names a registered trail effect and configures it.
     */
    trails?: readonly AppearanceTrail[];
    /**
     * For the `contained` assembly (#330): a registered container shell and its configuration,
     * and optionally the registered contents inside it (src/visual/contained.ts).
     */
    container?: ContainerConfig;
    contents?: ContentsConfig;
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
    lettering: { font: "Times New Roman", fallback: "Tinos, serif", weight: 400 },
    name: "Paper",
    acoustics: { character: "flimsy", hardness: 2, attach: "material.attach.paper" },
    traits: {},
    // Never sold as a card, so its transmogrifier sets its own price (#384: 2 coins) and is
    // offered from round 1 at a low weight (a safe default, noted on #388).
    transmogrifier: { price: 2, weights: [[1, 0.5]] },
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
    lettering: { font: "Roboto Slab", fallback: "serif", weight: 400 },
    name: "Wood",
    acoustics: { character: "knocking", hardness: 3, attach: "material.attach.wood" },
    traits: {},
    shop: {
      basePrice: 3,
      weights: [
        [1, 4],
        [2, 1.5],
        [3, 1],
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
    lettering: { font: "Saira Stencil One", fallback: "sans-serif", weight: 400 },
    name: "Steel",
    acoustics: { character: "clanking", hardness: 8, attach: "material.attach.steel" },
    traits: {},
    shop: {
      basePrice: 4,
      weights: [
        [2, 4],
        [3, 1.5],
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
    lettering: { font: "Roboto", fallback: "sans-serif", weight: 400 },
    name: "Prismatic Crystal",
    acoustics: { character: "ringing", hardness: 10, attach: "material.attach.prismatic" },
    traits: { transparent: {} },
    shop: {
      basePrice: 12,
      weights: [
        [7, 4],
        [8, 1.5],
        [9, 1],
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
    lettering: { font: "Tinos", fallback: "serif", weight: 400 },
    name: "Gold",
    acoustics: { character: "dense", hardness: 7, attach: "material.attach.gold" },
    traits: {},
    shop: {
      basePrice: 8,
      weights: [
        [6, 4],
        [7, 1.5],
        [8, 1],
      ],
    },
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
    lettering: { font: "Roboto Slab", fallback: "serif", weight: 400 },
    name: "Terracotta",
    acoustics: { character: "dry", hardness: 6, attach: "material.attach.terracotta" },
    traits: {},
    shop: {
      basePrice: 3,
      weights: [
        [3, 4],
        [4, 1.5],
        [5, 1],
      ],
    },
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
    lettering: { font: "Roboto", fallback: "sans-serif", weight: 400 },
    name: "Ice",
    acoustics: { character: "clinking", hardness: 5, attach: "material.attach.ice" },
    traits: { transparent: {} },
    shop: {
      basePrice: 2,
      weights: [
        [4, 4],
        [5, 1.5],
        [6, 1],
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
    lettering: { font: "Roboto Slab", fallback: "serif", weight: 400 },
    name: "Meat",
    acoustics: { character: "squishy", hardness: 1, attach: "material.attach.meat" },
    traits: {},
    shop: {
      basePrice: 6,
      weights: [
        [4, 4],
        [5, 1.5],
        [6, 1],
      ],
    },
    appearance: {
      pattern: "marbledFlesh",
      assembly: "sixFaces",
      surface: "matte",
      height: "none",
      ink: { red: "#bd3651", black: "#f4e9db", onDark: true },
      edge: { color: 0x6b2538, opacity: 0 },
      // A crudely chopped hunk: three or four cleaver cuts and shallow dents, its own per card.
      geometry: {
        shape: "chopped",
        segments: 8,
        radius: 0,
        scale: 1,
        chop: { cuts: [3, 4], depth: [0.08, 0.16], dent: 0.04 },
      },
      reliefScale: 2,
      // Like wood, the grain runs one way: the top and bottom are cut across it.
      endGrainFaces: [2, 3],
    },
  },
  {
    id: "fire",
    lettering: { font: "Saira Stencil One", fallback: "sans-serif", weight: 400 },
    name: "Fire",
    acoustics: { character: "rattling", hardness: 9, attach: "material.attach.fire" },
    traits: { transparent: {} },
    shop: {
      basePrice: 4,
      weights: [
        [4, 4],
        [5, 1.5],
        [6, 1],
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
  {
    id: "custard",
    lettering: { font: "Roboto Slab", fallback: "serif", weight: 400 },
    name: "Custard",
    // Plastic, between wood and ice (#232).
    acoustics: { character: "hollow", hardness: 4, attach: "material.attach.custard" },
    traits: { transparent: {} },
    shop: {
      basePrice: 3,
      // Unlocks in round 3 (#381), alongside terracotta.
      weights: [
        [3, 4],
        [4, 1.5],
        [5, 1],
      ],
    },
    // +2 to its base value, then ×1.2 on its line, when it contributes (#381).
    scoringModifier: { additive: 2, multiplicative: 1.2 },
    activation: { effect: { id: "pulse", colour: "#f2c84b" }, sfx: "material.activate.custard" },
    appearance: {
      pattern: "cardSheet",
      assembly: "contained",
      surface: "clear",
      height: "none",
      ink: lightInk,
      edge: { color: 0xe8eef2, opacity: 0.3 },
      geometry: { shape: "rounded", segments: 1, radius: 0.08, scale: 1 },
      reliefScale: 0,
      endGrainFaces: noEnds,
      container: {
        shell: "plasticShell",
        // The shell's reflections at full strength (gloss), so the plastic catches the light.
        config: { opacity: 0.16, inset: 0.92, gloss: 1.6 },
      },
      contents: {
        effect: "vesselFluid",
        config: {
          fill: 0xf2c84b,
          surface: 0xfadf7e,
          level: 0.45,
          settleSeconds: 1.4,
          traceSeconds: 4,
          traceOpacity: 0.45,
        },
      },
    },
  },
] as const satisfies readonly MaterialDefinition[];

/**
 * Visual experiments (#227): materials that exist only to be looked at in a developer mode.
 * They are not in `materialDefinitions`, so no shop, reward or attract sequence ever deals
 * them. A developer mode deals one only by asking: the `uniformMaterialDeck` run setup step, or
 * `materialDeck` with the `registered` pool (dev0, dev1). None at the moment: custard, the
 * first, became a gameplay material when the shop began to sell it. The empty vessel (#330) is custard's container with no contents, and Air (#357) is a vented housing.
 */
export const experimentalMaterials: readonly MaterialDefinition[] = [
  {
    // An empty plastic vessel (#330): custard's container with nothing inside, composed rather
    // than special-cased. A visual experiment only.
    id: "emptyVessel",
    lettering: { font: "Roboto Slab", fallback: "serif", weight: 400 },
    name: "Empty vessel",
    acoustics: { character: "hollow", hardness: 4, attach: "material.attach.custard" },
    traits: { transparent: {} },
    appearance: {
      pattern: "cardSheet",
      assembly: "contained",
      surface: "clear",
      height: "none",
      ink: lightInk,
      edge: { color: 0xe8eef2, opacity: 0.3 },
      geometry: { shape: "rounded", segments: 1, radius: 0.08, scale: 1 },
      reliefScale: 0,
      endGrainFaces: noEnds,
      container: { shell: "plasticShell", config: { opacity: 0.16, inset: 0.92, gloss: 1.6 } },
    },
  },
  {
    // Air (#357): a visual experiment only. A fan on two opposite faces (its variant faces,
    // +x and −x), louvred vents on the other four. No airflow, scoring, price or reward.
    id: "airVent",
    lettering: { font: "Saira Stencil One", fallback: "sans-serif", weight: 400 },
    name: "Air",
    // A powder-coated housing: it sounds like steel until it has a sound of its own.
    acoustics: { character: "clanking", hardness: 7, attach: "material.attach.steel" },
    traits: {},
    appearance: {
      pattern: "ventHousing",
      assembly: "sixFaces",
      surface: "matte",
      height: "none",
      ink: { red: "#a3202f", black: "#1f2c38", onDark: false },
      edge: { color: 0x6f7a82, opacity: 1 },
      geometry: { shape: "rounded", segments: 2, radius: 0.06, scale: 1 },
      reliefScale: 0,
      endGrainFaces: [0, 1],
    },
  },
];

export type BlockMaterial = (typeof materialDefinitions)[number]["id"];
export const blockMaterials: readonly BlockMaterial[] = materialDefinitions.map(({ id }) => id);
const materialRegistry = new Map<string, MaterialDefinition>(
  [...materialDefinitions, ...experimentalMaterials].map((item) => [item.id, item]),
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
  // Its material's rules, then its state bonus's (#365): same phases, and the order within
  // one card changes nothing (sums and products commute; successive powers multiply).
  return [
    ...scoringModifierRules(getMaterialDefinition(materialOf(block)).scoringModifier),
    ...stateBonusRules(block),
  ];
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

/**
 * Pools of materials a developer deck can deal from, by name: `gameplay` (what the game deals)
 * and `registered` (every registered material, visual experiments included, for seeing how all
 * of them look and meet; dev0).
 */
export const materialPools = new Registry<() => readonly MaterialDefinition[]>("material pool");
materialPools.register("gameplay", () => materialDefinitions);
materialPools.register("registered", () => [...materialRegistry.values()]);

/** Give every standard card one stable visual material for this dev run, from `pool`. */
export function makeDevDeck(seed: number, pool = "gameplay"): readonly CardBlock[] {
  const random = seededRandom(seed);
  const materials = materialPools.get(pool)();
  const assignments = standardDeck.map((_, index) => materials[index % materials.length]);
  for (let index = assignments.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [assignments[index], assignments[other]] = [assignments[other], assignments[index]];
  }
  return standardDeck.map((card, index) => withMaterial(card, assignments[index]));
}

/** Every standard card made of one material, for a mode that shows only that material (#227). */
export function makeUniformDeck(material: BlockMaterial): readonly CardBlock[] {
  const definition = getMaterialDefinition(material);
  return standardDeck.map((card) => withMaterial(card, definition));
}
