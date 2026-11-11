import { describe, expect, it } from "vite-plus/test";
import { getMaterialDefinition, materialPools } from "./materials";
import { weightAt } from "./offer-weights";
import { validateScoringModifier } from "./scoring-modifier";

describe("Magic material (#375)", () => {
  const magic = getMaterialDefinition("magic");

  it("is a gameplay material, never offered before round 8", () => {
    expect(
      materialPools
        .get("registered")()
        .some(({ id }) => id === "magic"),
    ).toBe(true);
    for (let round = 1; round < 8; round++) expect(weightAt(magic.shop!.weights, round)).toBe(0);
    expect(weightAt(magic.shop!.weights, 8)).toBeGreaterThan(0);
  });

  it("brings the agreed package: +1, ×2 and exponent 1.2, all valid", () => {
    expect(magic.scoringModifier).toEqual({ additive: 1, multiplicative: 2, exponential: 1.2 });
    expect(validateScoringModifier("magic", magic.scoringModifier!)).toEqual([]);
  });

  it("leaves Prismatic Crystal's approved exponent 1.1 unchanged", () => {
    expect(getMaterialDefinition("prismatic").scoringModifier).toEqual({ exponential: 1.1 });
  });

  it("looks like Magic Lock: the contained stars", () => {
    expect(magic.appearance.contents?.effect).toBe("stars");
    expect(magic.appearance.assembly).toBe("contained");
  });
});
