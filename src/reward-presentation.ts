/**
 * How each kind of ledger row is shown on the stage-won screen (#729; doc/presents.md, "Mixed
 * reward ledger and sound"): registered presentations, named by the entry. The screen formats
 * a row and plays its cue through the entry's presentation and never asks what the row is. A
 * presentation only shows a saved, already-committed reward; it never grants or pays anything.
 */
import type { SoundEffectId } from "./audio/sfx-registry";
import { Registry } from "./core/registry";
import { entryCoins, type RewardEntry } from "./stage-rewards";

export type RewardPresentation = {
  /** The row's value text, for example "+3 coins". */
  value(entry: RewardEntry): string;
  /** The sound played as the row appears. */
  cue: SoundEffectId;
};

export const rewardPresentations = new Registry<RewardPresentation>("reward presentation");

rewardPresentations.register("coins", {
  value(entry) {
    const coins = entryCoins(entry);
    return `+${coins} coin${coins === 1 ? "" : "s"}`;
  },
  cue: "reward.coin",
});
