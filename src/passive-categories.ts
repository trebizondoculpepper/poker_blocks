/**
 * The passive category facet (issue #81). Each category is a trait, and the facet is the set of
 * those traits: every passive composes exactly one of them, naming its primary purpose
 * (`passive-categories.test.ts` enforces this). A category trait brings presentation defaults
 * only: no rule, condition or effect reads it, and the same test holds gameplay code to that.
 *
 * The categories follow Balatro's grouping of Joker effects, with its four scoring types folded
 * into one Scoring category whose accent tint shows the scoring operation instead (additive icy
 * blue, multiplicative indigo, exponential violet; combined operations blend). `finish` names an
 * appearance-only surface (see #66) and never grants a card's gameplay material effects.
 */
import type { SoundEffectId } from "./audio/sfx-registry";
import type { PassivePalette } from "./passives";

/** How a scoring passive changes a score; it picks the accent tint, never the behaviour. */
export type ScoringOperation = "additive" | "multiplicative" | "exponential";

/** What a category plays when one of its passives activates (registered SFX id). */
export type CategoryActivation = {
  /** A short description of the visual effect, for the presentation that plays it. */
  visual: string;
  /** A registered sound effect id. */
  sfx: SoundEffectId;
};

/** What a category trait brings: presentation defaults, nothing else. */
export type PassiveCategoryDefaults = {
  /** The player-facing name. */
  name: string;
  /** The default block colours. */
  palette: PassivePalette;
  /** The appearance finish, for example porcelain; presentation only. */
  finish: string;
  activation: CategoryActivation;
};

/** The accent tint for each scoring operation, along the icy blue → indigo → violet continuum. */
export const scoringTints: Readonly<Record<ScoringOperation, string>> = {
  additive: "#7fc8e8",
  multiplicative: "#4b4fb8",
  exponential: "#8a3fc0",
};

/** The category facet: each category trait and its defaults, in one reviewable place. */
export const passiveCategoryFacet = {
  scoringCategory: {
    name: "Scoring",
    palette: { face: "#f3f0e9", ink: "#26282c", edge: "#b9b4aa" },
    finish: "porcelain",
    activation: { visual: "brief white score pulse", sfx: "passive.activate.scoring" },
  },
  economyCategory: {
    name: "Economy",
    palette: { face: "#1f6b3a", ink: "#f4e7b8", edge: "#b58a3c" },
    finish: "brass",
    activation: { visual: "green coin glint", sfx: "passive.activate.economy" },
  },
  effectCategory: {
    name: "Effect",
    palette: { face: "#16171a", ink: "#e9e6df", edge: "#4a4c52" },
    finish: "obsidian",
    activation: { visual: "brief dark ripple", sfx: "passive.activate.effect" },
  },
  retriggerCategory: {
    name: "Retrigger",
    palette: { face: "#d9762b", ink: "#2a1606", edge: "#9a4a14" },
    finish: "copper",
    activation: { visual: "quick orange echo ring", sfx: "passive.activate.retrigger" },
  },
} as const satisfies Record<string, PassiveCategoryDefaults>;

export type PassiveCategoryTrait = keyof typeof passiveCategoryFacet;

/**
 * The category traits a passive composes. Scoring names its operations (for the tint); the
 * others take no options.
 */
export type PassiveCategoryTraits = {
  scoringCategory: { operations: readonly ScoringOperation[] };
  economyCategory: Record<never, never>;
  effectCategory: Record<never, never>;
  retriggerCategory: Record<never, never>;
};

export const passiveCategoryTraitNames = Object.keys(
  passiveCategoryFacet,
) as PassiveCategoryTrait[];

/** The facet traits a set of traits composes (exactly one for a valid passive). */
export function categoryTraitsOf(traits: object): PassiveCategoryTrait[] {
  return passiveCategoryTraitNames.filter((name) => name in traits);
}

/** The defaults a passive's category trait brings. */
export function categoryDefaults(traits: object): PassiveCategoryDefaults {
  const [name] = categoryTraitsOf(traits);
  if (!name) throw new Error("A passive must compose one category trait");
  return passiveCategoryFacet[name];
}

/**
 * How each category resolves its passives' colours from its trait config and defaults. Each
 * category brings its own; only Scoring tints, by the blend of its operations.
 */
const categoryPalettes: {
  [Name in PassiveCategoryTrait]: (
    config: PassiveCategoryTraits[Name],
    defaults: PassiveCategoryDefaults,
  ) => PassivePalette;
} = {
  scoringCategory: ({ operations }, { palette }) => {
    if (operations.length === 0) return palette;
    const tint = blendColours(operations.map((operation) => scoringTints[operation]));
    return { ...palette, ink: tint, edge: tint };
  },
  economyCategory: (_config, { palette }) => palette,
  effectCategory: (_config, { palette }) => palette,
  retriggerCategory: (_config, { palette }) => palette,
};

/** The colours a passive's category gives it, resolved by that category's own handler. */
export function categoryPalette(traits: Partial<PassiveCategoryTraits>): PassivePalette {
  const [name] = categoryTraitsOf(traits);
  if (!name) throw new Error("A passive must compose one category trait");
  const resolve = categoryPalettes[name] as (
    config: PassiveCategoryTraits[PassiveCategoryTrait] | undefined,
    defaults: PassiveCategoryDefaults,
  ) => PassivePalette;
  return resolve(traits[name], passiveCategoryFacet[name]);
}

/** The even mix of several hex colours. */
export function blendColours(colours: readonly string[]): string {
  const channels = [0, 1, 2].map((channel) => {
    const values = colours.map((hex) =>
      Number.parseInt(hex.slice(1 + channel * 2, 3 + channel * 2), 16),
    );
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  });
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
