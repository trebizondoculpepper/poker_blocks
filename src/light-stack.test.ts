import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { PlacedBlock } from "./game-state";
import { getMaterialDefinition, withMaterial } from "./materials";
import { scoreFieldWithPassives } from "./passive-effects";
import { createPassiveBlock, ordinaryPassives } from "./passives";
import { easeOut, scoreCurves, validateQueryFactor, weightPassives } from "./trial-modifiers";

const light = (kg: number) => scoreCurves.get("massEaseOut").factor(kg, weightPassives.light);
const placed = (block: CardBlock, x: number): PlacedBlock => ({ block, cell: { x, y: 0, z: 0 } });
const row = (material: string) =>
  standardDeck
    .slice(0, 5)
    .map((card, x) => placed(withMaterial(card, getMaterialDefinition(material as never)), x));

describe("Light passive (#1072; doc/material-mass-and-passives.md)", () => {
  it("is ×1 at or above 1 kg, ×10 at or below 0.1 kg, eased between", () => {
    expect(light(1)).toBe(1);
    expect(light(5)).toBe(1);
    expect(light(0.1)).toBe(10);
    expect(light(0.01)).toBe(10);
    // Midway, 0.55 kg, the factor is 1 + 9 × easeOut(0.5) = 7.75.
    expect(light(0.55)).toBeCloseTo(7.75, 12);
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
  });

  it("rejects unbounded or degenerate configurations", () => {
    const config = (params: unknown) => ({
      query: "fieldMass",
      value: "totalKg",
      curve: "massEaseOut",
      params,
    });
    expect(validateQueryFactor("t", config(weightPassives.light))).toEqual([]);
    expect(validateQueryFactor("t", config({ ...weightPassives.light, maximum: 11 }))).toHaveLength(
      1,
    );
    expect(validateQueryFactor("t", config({ ...weightPassives.light, capKg: 1 }))).toHaveLength(1);
    expect(
      validateQueryFactor("t", config({ ...weightPassives.light, neutralKg: -1 })),
    ).toHaveLength(1);
  });

  it("multiplies a row by the whole field's eased lightness", () => {
    const paper = row("paper");
    const base = scoreFieldWithPassives(paper, [])[0]!;
    const scored = scoreFieldWithPassives(paper, [createPassiveBlock("light-stack", "l")])[0]!;
    // Five paper blocks weigh 80 g, under the 0.1 kg cap: ×10.
    expect(scored.points / base.points).toBeCloseTo(10, 6);
  });

  it("follows each block's current material", () => {
    const wood = row("wood");
    const base = scoreFieldWithPassives(wood, [])[0]!;
    const scored = scoreFieldWithPassives(wood, [createPassiveBlock("light-stack", "l")])[0]!;
    // 3.25 kg of wood is neutral: no change and no claimed bonus.
    expect(scored.points).toBe(base.points);
    expect(JSON.stringify(scored)).not.toContain("multiply-line-score-by-query");
  });

  it("is provisional, and offered in normal runs (#1393)", () => {
    expect(ordinaryPassives().map(({ id }) => id)).toContain("light-stack");
  });
});
