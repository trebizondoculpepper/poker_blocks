import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { cardLook } from "./card-look";
import { getMaterialDefinition, withMaterial } from "./materials";
import { donenessSteps, withDoneness, withoutDoneness } from "./cooking";

const meat = withMaterial(standardDeck[0]!, getMaterialDefinition("meat"));

describe("meat browns as it cooks (#376)", () => {
  it("shows each doneness step's configured tint, keeping rank, suit and identity", () => {
    const looks = getMaterialDefinition("meat").cookable!.looks!;
    expect(donenessSteps(meat)).toHaveLength(looks.length);
    donenessSteps(meat).forEach((_, step) => {
      const cooked = withDoneness(meat, step);
      expect(cardLook(cooked).appearance.tint).toEqual(looks[step] ?? undefined);
      expect(cooked.traits.identity).toEqual(meat.traits.identity);
    });
  });

  it("darkens step by step to Overcooked, the last step; no Burnt step", () => {
    const steps = donenessSteps(meat);
    expect(steps.at(-1)).toBe("Overcooked");
    expect(steps).not.toContain("Burnt");
    const strengths = steps.map(
      (_, step) => cardLook(withDoneness(meat, step)).appearance.tint?.strength ?? 0,
    );
    for (let step = 1; step < strengths.length; step++)
      expect(strengths[step]!).toBeGreaterThan(strengths[step - 1]!);
  });

  it("keeps Raw meat's own look, and returns to it when doneness resets", () => {
    expect(cardLook(meat)).toBe(getMaterialDefinition("meat"));
    expect(cardLook(withoutDoneness(withDoneness(meat, 5))).appearance.tint).toBeUndefined();
  });

  it("leaves materials that don't cook untouched", () => {
    const wood = withMaterial(standardDeck[1]!, getMaterialDefinition("wood"));
    expect(cardLook(wood)).toBe(getMaterialDefinition("wood"));
  });
});
