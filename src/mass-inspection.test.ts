import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { getMaterialDefinition, materialDefinitions, withMaterial } from "./materials";
import { formatMass, massKg, weightLine } from "./physical-mass";
import { inspectBlock } from "./traits/inspectable";
import { devOpaqueContainer } from "./dev-rankless-active";
import "./playable-payload";

describe("mass formatting (#1069)", () => {
  it("reads in grams below a kilogram and kilograms above, to three significant digits", () => {
    expect(formatMass(0.0012)).toBe("1.2 g");
    expect(formatMass(0.002)).toBe("2 g");
    expect(formatMass(0.016)).toBe("16 g");
    expect(formatMass(0.048)).toBe("48 g");
    expect(formatMass(0.8784)).toBe("878 g");
    expect(formatMass(1)).toBe("1 kg");
    expect(formatMass(19.32)).toBe("19.3 kg");
  });
});

describe("weight in block inspection (#1069)", () => {
  it("shows every material's resolved weight on an inspected card", () => {
    for (const definition of materialDefinitions) {
      if ("provider" in definition.mass) continue;
      const card = withMaterial(standardDeck[0]!, definition);
      expect(inspectBlock(card), definition.id).toContain(weightLine(massKg(definition.mass)));
    }
  });

  it("follows a material change at the next inspection", () => {
    const wood = withMaterial(standardDeck[0]!, getMaterialDefinition("wood"));
    const gold = withMaterial(wood, getMaterialDefinition("gold"));
    expect(inspectBlock(wood)).toContain("Weight: 650 g");
    expect(inspectBlock(gold)).toContain("Weight: 19.3 kg");
  });

  it("still shows the weight when a card has no description of its own", () => {
    const { inspectable: _drop, ...traits } = standardDeck[0]!.traits;
    const bare = { ...standardDeck[0]!, traits } as (typeof standardDeck)[0];
    expect(inspectBlock(bare)).toContain("Weight:");
  });

  it("shows a Present's contents-derived weight without revealing its contents (#1068)", () => {
    const present = withMaterial(
      devOpaqueContainer("p", {
        id: "p.contents",
        definition: "playableCard",
        components: { pokerIdentity: { rank: "K", suit: "spades" }, material: "gold" },
      }),
      getMaterialDefinition("giftWrap" as never),
    );
    const text = inspectBlock(present)!;
    expect(text).toContain("Weight: 19.3 kg");
    expect(text).not.toMatch(/gold|spades|\bK\b/i);
  });
});
