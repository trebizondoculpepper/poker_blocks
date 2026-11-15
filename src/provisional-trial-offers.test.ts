import { describe, expect, it } from "vite-plus/test";
import { getMaterialDefinition } from "./materials";
import { materialUnlockRound, passiveUnlockRound } from "./offer-eligibility";
import { ordinaryPassives, trialOffer } from "./passives";
import { passiveWeight } from "./shop-stock";

/** The implemented provisional gameplay trials, as the normal passive catalogue admits them. */
const trials = () =>
  ordinaryPassives().filter(({ releaseStatus }) => releaseStatus && "provisional" in releaseStatus);

describe("provisional trials in normal runs (#1393; doc/release-status.md)", () => {
  it("admits every implemented trial, each with an offer", () => {
    const ids = trials().map(({ id }) => id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "trial-dense-packing",
        "trial-sparse-packing",
        "trial-heavy-mean-mass",
        "trial-material-diversity",
        "dense-packing",
        "sparse-packing",
        "heavy-stack",
        "light-stack",
        "trial-in-the-loop",
        "trial-could-it-be-magic-now",
      ]),
    );
    for (const trial of trials()) expect(trial.shop, trial.id).toBeDefined();
  });

  it("offers each at the trial recipe's weight from its unlock round, and not before", () => {
    for (const trial of trials()) {
      expect(trial.shop!.basePrice, trial.id).toBe(trialOffer.basePrice);
      const opens = passiveUnlockRound(trial);
      expect(passiveWeight(trial, opens), trial.id).toBe(4);
      expect(passiveWeight(trial, opens - 1), trial.id).toBe(0);
    }
  });

  it("keeps a trial that names a material locked until that material unlocks", () => {
    const magic = ordinaryPassives().find(({ id }) => id === "trial-could-it-be-magic-now")!;
    expect(passiveUnlockRound(magic)).toBe(materialUnlockRound(getMaterialDefinition("magic")));
  });
});
