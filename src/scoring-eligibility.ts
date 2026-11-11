/**
 * Scoring eligibility (#423): how a card that is in a scored line but not part of its chosen hand
 * takes part in scoring. Each material names a registered eligibility (default `contributing`);
 * the line scorer asks that handler what the card adds and never asks what the card is.
 *
 * - `contributing`: nothing. Only the chosen hand's cards bring their rules (the original rule).
 * - `rowPresence`: the card's own scoring package always applies to its line. Its line rules
 *   (×, ^) join the line phases, and the bonus its own block rules add (+N) joins the line's
 *   points at the hand's multiplier. Its rank value doesn't count, and the hand's classification
 *   is unchanged: it is not a wildcard. Clouds use it.
 */
import { Registry } from "./core/registry";
import type { CardBlock } from "./cards";

export type NonContributingShare = {
  /** Points added to the line before its phases: the card's own block bonus, at the hand's multiplier. */
  points: number;
  /** Whether the card's own rules join the line phases. */
  joinsLinePhases: boolean;
};

/**
 * What a non-contributing card in a scored line adds: given its own block bonus (its block value
 * under its own rules, less its plain value) and the chosen hand's multiplier.
 */
export type ScoringEligibility = (
  block: CardBlock,
  ownBonus: number,
  handMultiplier: number,
) => NonContributingShare;

export const scoringEligibilities = new Registry<ScoringEligibility>("scoring eligibility");

scoringEligibilities.register("contributing", () => ({ points: 0, joinsLinePhases: false }));
scoringEligibilities.register("rowPresence", (_block, ownBonus, handMultiplier) => ({
  points: ownBonus * handMultiplier,
  joinsLinePhases: true,
}));
