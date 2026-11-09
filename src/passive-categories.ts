/**
 * The passive category facet (issue #81). Each category is a trait, and the facet is the set of
 * those traits: every passive composes exactly one of them, naming its primary purpose
 * (`passive-categories.test.ts` enforces this). A category trait brings presentation defaults
 * only: no rule, condition or effect reads it, and the same test holds gameplay code to that.
 *
 * A category's `palette` is the default look of its passives' blocks; a passive definition may
 * override it. `finish` names an appearance-only surface (see #66) and never grants a card's
 * gameplay material effects.
 */
import type { PassivePalette } from "./passives";

/** What a category trait brings: presentation defaults, nothing else. */
export type PassiveCategoryDefaults = {
  /** The player-facing name. */
  name: string;
  /** The default block colours. */
  palette: PassivePalette;
  /** The appearance finish, for example porcelain; presentation only. */
  finish: string;
};

/** The category facet: each category trait and its defaults, in one reviewable place. */
export const passiveCategoryFacet = {
  scoringCategory: {
    name: "Scoring",
    palette: { face: "#f3f0e9", ink: "#26282c", edge: "#b9b4aa" },
    finish: "porcelain",
  },
  economyCategory: {
    name: "Economy",
    palette: { face: "#1f6b3a", ink: "#f4e7b8", edge: "#b58a3c" },
    finish: "brass",
  },
  utilityCategory: {
    name: "Utility",
    palette: { face: "#16171a", ink: "#e9e6df", edge: "#4a4c52" },
    finish: "obsidian",
  },
} as const satisfies Record<string, PassiveCategoryDefaults>;

export type PassiveCategoryTrait = keyof typeof passiveCategoryFacet;

/** The category traits a passive composes; configured with no options of their own. */
export type PassiveCategoryTraits = { [Name in PassiveCategoryTrait]: Record<never, never> };

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
