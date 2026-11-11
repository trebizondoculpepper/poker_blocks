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

export type ScoringEligibility = {
  /**
   * The part of a card's own block bonus it brings whatever hand is chosen. It is left out of
   * the card's value while the hand is chosen (so it can't change which hand that is) and added
   * to the line once, at the hand's multiplier.
   */
  guaranteed: (ownBonus: number) => number;
  /** Whether the card's own line rules join the line phases when it isn't in the chosen hand. */
  joinsWhenOutside: boolean;
};

export const scoringEligibilities = new Registry<ScoringEligibility>("scoring eligibility");

scoringEligibilities.register("contributing", { guaranteed: () => 0, joinsWhenOutside: false });
scoringEligibilities.register("rowPresence", {
  guaranteed: (ownBonus) => ownBonus,
  joinsWhenOutside: true,
});
