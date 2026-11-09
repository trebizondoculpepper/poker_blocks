/**
 * Passive categories (issue #81): each passive's primary purpose, and the presentation defaults
 * that purpose supplies. Descriptive metadata only: no rule, condition or effect reads a
 * category, and `passive-categories.test.ts` holds gameplay code to that.
 *
 * A category's `palette` is the default look of its passives' blocks; a passive definition may
 * override it. `finish` names an appearance-only surface (see #66) and never grants a card's
 * gameplay material effects.
 */
import type { PassivePalette } from "./passives";

export type PassiveCategoryDefaults = {
  /** The player-facing name. */
  name: string;
  /** The default block colours: white, green or black for the first three categories. */
  palette: PassivePalette;
  /** The appearance finish, for example porcelain; presentation only. */
  finish: string;
};

/** Every category's defaults, in one reviewable place. */
export const passiveCategories = {
  scoring: {
    name: "Scoring",
    palette: { face: "#f3f0e9", ink: "#26282c", edge: "#b9b4aa" },
    finish: "porcelain",
  },
  economy: {
    name: "Economy",
    palette: { face: "#1f6b3a", ink: "#f4e7b8", edge: "#b58a3c" },
    finish: "brass",
  },
  utility: {
    name: "Utility",
    palette: { face: "#16171a", ink: "#e9e6df", edge: "#4a4c52" },
    finish: "obsidian",
  },
} as const satisfies Record<string, PassiveCategoryDefaults>;

export type PassiveCategory = keyof typeof passiveCategories;
