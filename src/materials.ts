import type { ChopSettings } from "./visual/chopped-geometry";
import type { Lettering } from "./visual/lettering";
import { Registry } from "./core/registry";
import type {
  ContainerConfig,
  ContentsConfig,
  ResidueConfig,
  InclusionConfig,
} from "./visual/contained";
import { cardName, standardDeck, type CardBlock } from "./cards";
import { inspectable } from "./traits/inspectable";
import type { WeightCurve } from "./offer-weights";
import type { EventRule, RuleCommand } from "./event-rules";
import type { ResistantTrait } from "./traits/resistant";
import type { Reaction } from "./reactions";
import { acquiredModifierRules } from "./modifier-registers";
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
/** A colour laid over a face's pattern at a strength from 0 (none) to 1 (solid). */
export type FaceTint = { colour: string; strength: number };

export type MaterialDefinition = {
  id: string;
  name: string;
  /** Default text font for letter and word cubes; does not affect card faces. */
  lettering?: Lettering;
  traits: { transparent?: Record<string, never>; resistant?: ResistantTrait };
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
   * What happens to a block of this material when a face neighbour sets it off (#366): each
   * reaction names a registered matcher (`when`) and registered results, the first that
   * matches taking effect once per play (src/reactions.ts).
   */
  reactions?: readonly Reaction[];
  /**
   * What a block of this material does when something triggers it (#433): registered rule
   * commands, committed in order through the shared command path (src/triggers.ts). Kept on
   * the definition, so a saved card restores it with its material.
   */
  triggerable?: { responses: readonly RuleCommand[] };
  /** Triggers its block after `start` committed plays on the table (#434, src/trigger-countdown.ts). */
  triggerCountdown?: { start: number; countPlacement: boolean };
  /**
   * The material is a source of heat (#383): a neighbour that heat-sensitive reactions react to,
   * read by the `neighbour-heat` matcher. Flame has it; anything else may declare it.
   */
  heat?: Record<string, never>;
  /**
   * How a card of this material takes part in a scored line it isn't in the chosen hand of: a
   * registered scoring eligibility (src/scoring-eligibility.ts). Default `contributing`.
   */
  scoringEligibility?: string;
  /** The material its cards become when a round ends, e.g. gelato back to custard (#383). */
  roundEndMaterial?: string;
  /**
   * Doneness steps, first (raw) to last, for a material that cooks (#372), and optionally the
   * face tint each step shows (#376), in the same order; a missing or null entry keeps the
   * material's own look.
   */
  cookable?: { steps: readonly string[]; looks?: readonly (FaceTint | null)[] };
  /**
   * Its transmogrifier's balance, where the default (twice the shop base price, drawn by the
   * material's own weight curve) does not apply or there is no shop price (#388).
   */
  transmogrifier?: { price?: number; weights?: WeightCurve };
  /**
   * Coins per card of this material left on the field at settlement, on both a win and a loss,
   * counting only cards at one of the listed doneness steps (steak, #373).
   */
  fieldReward?: { coinsPerCard: number; doneness: readonly string[]; label: string };
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
    /** A colour washed over the face pattern, under the print (#376: meat browning). */
    tint?: FaceTint;
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
    /** Optional residue on the wall, reading what the contents publish (#332). */
    residue?: ResidueConfig;
    /** Optional inclusions suspended in the contents, e.g. rising bubbles (#353). */
    inclusions?: readonly InclusionConfig[];
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

/**
 * Magic Lock's stars (#349): a sparse, fizzing field of the crystal trail's stars, each aging
 * brilliant white, cream, brown, then black (and gone). Weak gravity, gentle drift.
 */
const magicStars = {
  effect: "stars",
  config: {
    count: 36,
    life: 2.6,
    size: 0.3,
    drift: 0.12,
    gravity: 0.05,
    ramp: [0xffffff, 0xfff1cc, 0x8a5a2b, 0x000000],
  },
};

const slowEarth = {
  effect: "levellingFluid",
  config: {
    level: 0.5,
    settleSeconds: 5,
    look: { id: "opaqueFluid", config: { fill: 0x5b3a22, surface: 0x6e4a2c } },
  },
};
const grass = {
  effect: "growingGrass",
  config: {
    count: 90,
    delay: 5,
    interval: 0.12,
    growSeconds: 0.8,
    height: 0.14,
    width: 0.025,
    base: 0x2f6b22,
    tip: 0x8fd16a,
    turnDegrees: 30,
    settledDegrees: 20,
  },
};

/** A material with inclusions suspended in its contents (#353). */
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
    // Immune to bomb blasts (#437): it survives to collect transferred bonuses.
    traits: { resistant: { causes: ["explosion"] } },
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
    // Immune to bomb blasts, like steel (#437).
    traits: { resistant: { causes: ["explosion"] } },
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
    // Earth (#371): sold from round 2, in terracotta's old place. Beside flame it bakes into
    // terracotta. Its look is #358's soil with grass, in a plastic vessel.
    id: "earth",
    lettering: { font: "Roboto Slab", fallback: "serif", weight: 400 },
    name: "Earth",
    acoustics: { character: "dry", hardness: 3.5, attach: "material.attach.terracotta" },
    reactions: [
      {
        when: { id: "neighbour-material", config: { material: "fire" } },
        results: [{ id: "transform", config: { material: "terracotta", sound: "reaction.bake" } }],
      },
    ],
    traits: { transparent: {} },
    shop: {
      basePrice: 3,
      weights: [
        [2, 4],
        [3, 1.5],
        [4, 1],
      ],
    },
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
      contents: slowEarth,
      inclusions: [grass],
    },
  },
  {
    id: "terracotta",
    lettering: { font: "Roboto Slab", fallback: "serif", weight: 400 },
    name: "Terracotta",
    acoustics: { character: "dry", hardness: 6, attach: "material.attach.terracotta" },
    // Only ever made by a reaction: flame bakes earth into it (#371). It keeps its price at zero
    // weight, so no shop draws it (as a card or a transmogrifier), but a saved offer or item
    // still loads and is priced (#429 review).
    traits: {},
    shop: { basePrice: 3, weights: [[1, 0]] },
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
    // Melts beside flame or hot water into water with a +1 bonus (#367). Rank and suit stay.
    reactions: [
      {
        when: { id: "neighbour-material", config: { material: "fire" } },
        results: [
          {
            id: "transform",
            config: { material: "water", stateBonus: "melted", sound: "reaction.melt" },
          },
        ],
      },
      {
        when: { id: "neighbour-state", config: { material: "water", stateBonus: "heated" } },
        results: [
          {
            id: "transform",
            config: { material: "water", stateBonus: "melted", sound: "reaction.melt" },
          },
        ],
      },
    ],
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
    // Cooks one step per play beside flame or boiling water, stopping at Overcooked; back to
    // Raw each stage (#372).
    // A coin per steak left on the table at settlement: Bloody, Rare or Medium Rare (#373).
    fieldReward: { coinsPerCard: 1, doneness: ["Bloody", "Rare", "Medium Rare"], label: "Steak" },
    // Each step shows less pink and more browning: Raw is meat's own look, Well Done fully
    // brown, Overcooked dark brown (#376). Starting shades, for audition.
    cookable: {
      steps: ["Raw", "Bloody", "Rare", "Medium Rare", "Well Done", "Overcooked"],
      looks: [
        null,
        { colour: "#8a3b2c", strength: 0.18 },
        { colour: "#7f4128", strength: 0.36 },
        { colour: "#764528", strength: 0.52 },
        { colour: "#6a4326", strength: 0.78 },
        { colour: "#3a2414", strength: 0.88 },
      ],
    },
    reactions: [
      {
        when: { id: "neighbour-material", config: { material: "fire" } },
        results: [{ id: "advance-cooking", config: { steps: 1, sound: "reaction.cook" } }],
      },
      {
        when: { id: "neighbour-state", config: { material: "water", stateBonus: "boiled" } },
        results: [{ id: "advance-cooking", config: { steps: 1, sound: "reaction.cook" } }],
      },
    ],
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
    // Air beside it stokes it into aggressive flame, the same card (#370).
    // Flame is a source of heat (#383): it thaws gelato and keeps custard from freezing.
    heat: {},
    reactions: [
      {
        when: {
          id: "neighbour-material",
          config: { material: "airVent", unlessState: ["aggressive"] },
        },
        results: [
          { id: "transform", config: { stateBonus: "aggressive", sound: "reaction.stoke" } },
        ],
      },
    ],
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
      assembly: "contained",
      surface: "iron",
      height: "frameRelief",
      ink: { red: "#6e1a1a", black: "#24282c", onDark: false },
      edge: { color: 0x2a2f34, opacity: 1 },
      geometry: { ...box, scale: 0.985 },
      reliefScale: 2.5,
      endGrainFaces: noEnds,
      // The iron frame and glass panes, holding a flame (#335).
      container: { shell: "framedGlass", config: { inset: 0.97, glass: 1.2 } },
      contents: { effect: "flame", config: {} },
    },
  },
  {
    id: "custard",
    lettering: { font: "Roboto Slab", fallback: "serif", weight: 400 },
    name: "Custard",
    // Plastic, between wood and ice (#232).
    acoustics: { character: "hollow", hardness: 4, attach: "material.attach.custard" },
    // Ice freezes it into gelato (#383), unless a source of heat is beside it too.
    reactions: [
      {
        when: {
          id: "neighbour-material",
          config: { material: "ice", unlessNeighbour: [{ id: "neighbour-heat", config: {} }] },
        },
        results: [{ id: "transform", config: { material: "gelato", sound: "reaction.freeze" } }],
      },
    ],
    traits: { transparent: {} },
    shop: {
      basePrice: 3,
      // Unlocks in round 3 (#381).
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
        effect: "levellingFluid",
        config: {
          level: 0.45,
          settleSeconds: 1.4,
          look: { id: "opaqueFluid", config: { fill: 0xf2c84b, surface: 0xfadf7e } },
        },
      },
      // A fading film with local history (#334): wet walls refresh it, exposed patches fade.
      residue: {
        effect: "fadingFilm",
        config: { fill: 0xf2c84b, opacity: 0.45, seconds: 4, resolution: 32 },
      },
    },
  },
  {
    // Gelato (#383): only ever made by a reaction (ice beside custard), never sold. +4 and ×1.5
    // in place of custard's +2 and ×1.2. Heat beside it thaws it back to custard, and every
    // gelato card reverts to custard when the round ends. Its look is #382's settling scoops.
    id: "gelato",
    lettering: { font: "Roboto Slab", fallback: "serif", weight: 400 },
    name: "Gelato",
    acoustics: { character: "muffled", hardness: 4.5, attach: "material.attach.custard" },
    traits: { transparent: {} },
    scoringModifier: { additive: 4, multiplicative: 1.5 },
    activation: { effect: { id: "pulse", colour: "#f2a0b4" }, sfx: "material.activate.gelato" },
    reactions: [
      {
        when: { id: "neighbour-heat", config: {} },
        results: [{ id: "transform", config: { material: "custard", sound: "reaction.thaw" } }],
      },
    ],
    roundEndMaterial: "custard",
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
      // Frosted plastic: more opaque and less glossy than custard's, so it refracts little.
      container: { shell: "plasticShell", config: { opacity: 0.42, inset: 0.92, gloss: 0.4 } },
      contents: {
        effect: "settlingScoops",
        config: {
          colours: [0x4a2b1a, 0xf3df8f, 0xf2a0b4],
          radius: 0.16,
          gravity: 3,
          damping: 0.05,
          roughness: 0.85,
        },
      },
    },
  },
  {
    // Cloud (#423): only ever made by a reaction (air beside boiling water, #425), never sold.
    // +2 and ×1.5, and it always applies to a scored line it is in, chosen hand or not
    // (`rowPresence`): it enhances the hand without changing it, and is never a wildcard.
    // Its look is #336's contained cloud.
    id: "cloud",
    lettering: { font: "Roboto Slab", fallback: "serif", weight: 400 },
    name: "Cloud",
    acoustics: { character: "soft", hardness: 0.5, attach: "material.attach.meat" },
    traits: { transparent: {} },
    scoringModifier: { additive: 2, multiplicative: 1.5 },
    scoringEligibility: "rowPresence",
    activation: { effect: { id: "pulse", colour: "#f4f7fb" }, sfx: "material.activate.cloud" },
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
      contents: { effect: "cloud", config: { colour: 0xf4f7fb, density: 1.2, drift: 0.08 } },
    },
  },
  {
    // Water (#367): only ever made by a reaction (ice melting), never sold or unlocked, so it
    // has no shop price. A clear blue fluid in custard's plastic vessel until #333 gives it
    // refractive optics.
    id: "water",
    lettering: { font: "Roboto Slab", fallback: "serif", weight: 400 },
    name: "Water",
    acoustics: { character: "splashy", hardness: 1.5, attach: "material.attach.custard" },
    // Ordinary flame heats it into hot water: the "heated" +1 bonus replaces any it had, but
    // boiling water stays boiling (#368, #369).
    reactions: [
      // Aggressive flame boils it: ×2, replacing its bonus. Listed first, so aggressive flame
      // (which is still fire) boils water rather than merely heating it (#369).
      {
        when: { id: "neighbour-state", config: { material: "fire", stateBonus: "aggressive" } },
        results: [{ id: "transform", config: { stateBonus: "boiled", sound: "reaction.boil" } }],
      },
      {
        when: { id: "neighbour-material", config: { material: "fire", unlessState: ["boiled"] } },
        results: [{ id: "transform", config: { stateBonus: "heated", sound: "reaction.heat" } }],
      },
    ],
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
      contents: {
        effect: "levellingFluid",
        // Clear, refracting water (#333's look), with the same level and settling as before.
        config: {
          level: 0.55,
          settleSeconds: 0.5,
          look: {
            id: "refractiveFluid",
            config: {
              tint: 0xe8f6ff,
              ior: 1.33,
              thickness: 0.6,
              roughness: 0.04,
              attenuation: 0x7fc8ee,
              attenuationDistance: 1.6,
            },
          },
        },
      },
      residue: { effect: "wallTrace", config: { fill: 0x5fa8d8, seconds: 1.5, opacity: 0.3 } },
    },
  },
  {
    // Magic (#375): the round-8 material. Its look is Magic Lock's (#349): the crystal trail's
    // stars, aging white to black, in a plastic vessel. Its scoring package is +1, ×2 and ^1.2,
    // applied by the shared scorer in its documented order. Price: assumed 16 (see #375).
    id: "magic",
    lettering: { font: "Roboto Slab", fallback: "serif", weight: 400 },
    name: "Magic",
    acoustics: { character: "ringing", hardness: 10.5, attach: "material.attach.prismatic" },
    traits: { transparent: {} },
    shop: {
      basePrice: 16,
      weights: [
        [8, 4],
        [9, 1.5],
        [10, 1],
      ],
    },
    scoringModifier: { additive: 1, multiplicative: 2, exponential: 1.2 },
    activation: { effect: { id: "pulse", colour: "#fff1cc" }, sfx: "material.activate.magic" },
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
      contents: magicStars,
    },
  },
] as const satisfies readonly MaterialDefinition[];

/** Custard's contents, shared by every experiment that shows them in another shell (#331). */
const custardContents = {
  effect: "levellingFluid",
  config: {
    level: 0.45,
    settleSeconds: 1.4,
    look: { id: "opaqueFluid", config: { fill: 0xf2c84b, surface: 0xfadf7e } },
  },
};
/** Custard's wall trace, shared the same way. */
const custardResidue = {
  effect: "fadingFilm",
  config: { fill: 0xf2c84b, opacity: 0.45, seconds: 4, resolution: 32 },
};

/** Clear, refracting water (#333): the levelling fluid with the `refractiveFluid` look. */
const clearWater = {
  effect: "levellingFluid",
  config: {
    level: 0.55,
    settleSeconds: 0.5,
    look: {
      id: "refractiveFluid",
      config: {
        tint: 0xe8f6ff,
        ior: 1.33,
        thickness: 0.6,
        roughness: 0.04,
        attenuation: 0x7fc8ee,
        attenuationDistance: 1.6,
      },
    },
  },
};

/** Very slow bubbles (#353): hot water's, sparse and lazy. Boiling water (#354) is the same, faster. */
const slowBubbles = {
  effect: "risingBubbles",
  config: {
    count: 20,
    rise: 0.06,
    wobble: 0.02,
    size: 0.1,
    rest: 1.6,
    colour: 0xeaf6ff,
    opacity: 0.7,
  },
};

/** Fast bubbles (#354): boiling water's, the same handler as hot water's, busier and quicker. */
const fastBubbles = {
  effect: "risingBubbles",
  config: {
    count: 48,
    rise: 0.6,
    wobble: 0.05,
    size: 0.09,
    rest: 0.25,
    colour: 0xeaf6ff,
    opacity: 0.8,
  },
};

/**
 * Earth (#358): brown soil that conforms very slowly to its new base, with no wall residue, and
 * grass that grows on its settled top after about five seconds of stillness.
 */
function withInclusions(
  material: MaterialDefinition,
  inclusions: readonly InclusionConfig[],
): MaterialDefinition {
  return { ...material, appearance: { ...material.appearance, inclusions } };
}

/** A soft drifting cloud (#336): contents with no liquid surface. */
const softCloud = {
  effect: "cloud",
  config: { colour: 0xf4f7fb, density: 1.2, drift: 0.08 },
};

/** A dark, oily fluid (#333): custard's look and mechanics with only its colours changed. */
const darkFluid = {
  effect: "levellingFluid",
  config: {
    level: 0.5,
    settleSeconds: 2.5,
    look: { id: "opaqueFluid", config: { fill: 0x1b1712, surface: 0x3a3127 } },
  },
};

/** The retired glass block's six pane tints (f99d307), in BoxGeometry face order. */
const lanternTints = [0xff9aa8, 0xffd27a, 0xf4fbff, 0x8fe3b0, 0x8fb4ff, 0xc9a6ff];

/** Water and a dark fluid in custard's plastic vessel (#333). */
function plasticFluidExperiments(): MaterialDefinition[] {
  const plastic = (
    id: string,
    name: string,
    contents: MaterialDefinition["appearance"]["contents"],
  ): MaterialDefinition => ({
    id,
    lettering: { font: "Roboto Slab", fallback: "serif", weight: 400 },
    name,
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
      contents,
    },
  });
  return [
    plastic("waterInPlastic", "Water in plastic", clearWater),
    // Earth (#358): slow soil with grass, in plastic and in the lantern; no residue.
    withInclusions(plastic("earthInPlastic", "Earth in plastic", slowEarth), [grass]),
    // Hot water (#353): the same water, with very slowly rising bubbles as an inclusion.
    withInclusions(plastic("hotWaterInPlastic", "Hot water in plastic", clearWater), [slowBubbles]),
    // Boiling water (#354): the same water, with fast bubbles.
    withInclusions(plastic("boilingWaterInPlastic", "Boiling water in plastic", clearWater), [
      fastBubbles,
    ]),
    plastic("darkFluid", "Dark fluid", darkFluid),
    plastic("cloudInPlastic", "Cloud in plastic", softCloud),
    plastic("magicLock", "Magic Lock", magicStars),
  ];
}

/**
 * Glass containers (#331): the stained lantern empty and holding custard, and custard in the
 * fire's iron frame. The same contents in a different shell is configuration only.
 */
function glassContainerExperiments(): MaterialDefinition[] {
  const lantern = (
    id: string,
    name: string,
    contents?: MaterialDefinition["appearance"]["contents"],
    residue?: MaterialDefinition["appearance"]["residue"],
  ) => ({
    id,
    lettering: { font: "Roboto", fallback: "sans-serif", weight: 400 },
    name,
    acoustics: { character: "ringing", hardness: 9, attach: "material.attach.prismatic" as const },
    traits: { transparent: {} },
    appearance: {
      pattern: "leadedGlass",
      assembly: "contained",
      surface: "clear",
      height: "none",
      ink: lightInk,
      edge: { color: 0x262b30, opacity: 0.8 },
      geometry: { ...box, scale: 0.985 },
      reliefScale: 0,
      endGrainFaces: noEnds,
      container: { shell: "stainedLantern", config: { inset: 0.88, tints: lanternTints } },
      ...(contents ? { contents } : {}),
      ...(residue ? { residue } : {}),
    },
  });
  return [
    lantern("emptyLantern", "Empty lantern"),
    lantern("custardLantern", "Custard in a lantern", custardContents, custardResidue),
    lantern("flameLantern", "Flame in a lantern", { effect: "flame", config: {} }),
    // Fluid looks (#333): the same levelling fluid, other optics, in either container.
    lantern("waterInLantern", "Water in a lantern", clearWater),
    // A contained cloud (#336): the same contents in either container.
    lantern("cloudInLantern", "Cloud in a lantern", softCloud),
    withInclusions(lantern("earthInLantern", "Earth in a lantern", slowEarth), [grass]),
    // Magic Lock (#349): the crystal trail's stars, aging white to black, in either container.
    lantern("magicLockLantern", "Magic Lock (lantern)", magicStars),
    {
      // Aggressive flame (#355): the fire block's own flame, slightly larger and brighter, in the
      // same iron frame. A visual variant only: configuration of the same flame.
      id: "aggressiveFlame",
      lettering: { font: "Saira Stencil One", fallback: "sans-serif", weight: 400 },
      name: "Aggressive flame",
      acoustics: { character: "rattling", hardness: 9, attach: "material.attach.fire" as const },
      traits: { transparent: {} },
      appearance: {
        pattern: "ironFrame",
        assembly: "contained",
        surface: "iron",
        height: "frameRelief",
        ink: { red: "#6e1a1a", black: "#24282c", onDark: false },
        edge: { color: 0x2a2f34, opacity: 1 },
        geometry: { ...box, scale: 0.985 },
        reliefScale: 2.5,
        endGrainFaces: noEnds,
        container: { shell: "framedGlass", config: { inset: 0.97, glass: 1.2 } },
        contents: { effect: "flame", config: { scale: 1.04, brightness: 1.3 } },
      },
    },
    {
      id: "custardFrame",
      lettering: { font: "Roboto", fallback: "sans-serif", weight: 400 },
      name: "Custard in a frame",
      acoustics: { character: "clanking", hardness: 8, attach: "material.attach.fire" as const },
      traits: { transparent: {} },
      appearance: {
        pattern: "ironFrame",
        assembly: "contained",
        surface: "iron",
        height: "frameRelief",
        ink: { red: "#6e1a1a", black: "#24282c", onDark: false },
        edge: { color: 0x2a2f34, opacity: 1 },
        geometry: { ...box, scale: 0.985 },
        reliefScale: 2.5,
        endGrainFaces: noEnds,
        container: { shell: "framedGlass", config: { inset: 0.86, glass: 1.2 } },
        contents: custardContents,
        residue: custardResidue,
      },
    },
  ];
}

/**
 * Visual experiments (#227): materials that exist only to be looked at in a developer mode.
 * They are not in `materialDefinitions`, so no shop, reward or attract sequence ever deals
 * them. A developer mode deals one only by asking: the `uniformMaterialDeck` run setup step, or
 * `materialDeck` with the `registered` pool (dev0, dev1). None at the moment: custard, the
 * first, became a gameplay material when the shop began to sell it. The empty vessel (#330) is custard's container with no contents, and Air (#357) is a vented housing.
 */
export const experimentalMaterials: readonly MaterialDefinition[] = [
  {
    // The Present's wrapped look (#496, epic #492): a visual experiment for audition only, never
    // dealt or stocked. Foil wrap, a contrasting shiny ribbon and rosette, folds underneath; its
    // colours come from each block's own art seed. No rank or suit is printed.
    id: "giftWrap",
    lettering: { font: "Roboto Slab", fallback: "serif", weight: 400 },
    name: "Present (gift wrap)",
    acoustics: { character: "papery", hardness: 2, attach: "material.attach.paper" },
    traits: {},
    appearance: {
      pattern: "cardSheet",
      assembly: "giftBox",
      surface: "matte",
      height: "none",
      ink: lightInk,
      edge: { color: 0x000000, opacity: 0 },
      // Slightly rounded edges, as the owner asked.
      geometry: { shape: "rounded", segments: 3, radius: 0.06, scale: 1 },
      reliefScale: 0,
      endGrainFaces: noEnds,
    },
  },
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
    // Beside boiling water it makes a Cloud beyond the pair (#425), once per play per pair.
    reactions: [
      {
        when: { id: "neighbour-state", config: { material: "water", stateBonus: "boiled" } },
        results: [
          {
            id: "spawn-beyond-pair",
            config: {
              partner: { material: "water", stateBonus: "boiled" },
              material: "cloud",
              sound: "reaction.condense",
            },
          },
        ],
      },
    ],
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
  ...glassContainerExperiments(),
  ...plasticFluidExperiments(),
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
/** The scoring eligibility a card's material names (#423): `contributing` unless it says otherwise. */
export function scoringEligibilityOf(block: CardBlock): string {
  // A material that isn't registered (a test's own) names none, so it takes the default.
  return materialRegistry.get(materialOf(block))?.scoringEligibility ?? "contributing";
}

export function cardScoringRules(block: CardBlock): EventRule[] {
  // Its material's rules, then its state bonus's (#365), then its acquired modifiers' (#431):
  // same phases, and the order within one card changes nothing (sums and products commute;
  // exponents add their increases above 1).
  return [
    ...scoringModifierRules(getMaterialDefinition(materialOf(block)).scoringModifier),
    ...stateBonusRules(block),
    ...acquiredModifierRules(block),
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
      // A cookable material names its first doneness step too ("· Raw", #372).
      inspectable: inspectable(
        [
          cardName(card.traits.identity),
          definition.name,
          ...[definition.cookable?.steps.at(0) ?? []].flat(),
        ].join(" · "),
      ),
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
