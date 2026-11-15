import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { PlacedBlock } from "./game-state";
import { getMaterialDefinition, withMaterial } from "./materials";
import { scoreFieldWithPassives } from "./passive-effects";
import { createPassiveBlock, ordinaryPassives } from "./passives";
import { massKg } from "./physical-mass";
import { scoreCurves, validateQueryFactor, weightPassives } from "./trial-modifiers";

const heavy = (kg: number) => scoreCurves.get("massEaseOut").factor(kg, weightPassives.heavy);
const placed = (block: CardBlock, x: number): PlacedBlock => ({ block, cell: { x, y: 0, z: 0 } });
const row = (material: string, count = 5) =>
  standardDeck
    .slice(0, count)
    .map((card, x) => placed(withMaterial(card, getMaterialDefinition(material as never)), x));

describe("Heavy passive (#1073; doc/material-mass-and-passives.md)", () => {
  it("takes its reference from the shared gold calibration", () => {
    expect(weightPassives.heavy.neutralKg).toBe(massKg(getMaterialDefinition("gold").mass));
    expect(weightPassives.heavy.neutralKg).toBeCloseTo(19.32, 12);
    expect(weightPassives.heavy.capKg).toBeCloseTo(77.28, 12);
    expect(
      validateQueryFactor("h", {
        query: "fieldMass",
        value: "totalKg",
        curve: "massEaseOut",
        params: weightPassives.heavy,
      }),
    ).toEqual([]);
  });

  it("is ×1 up to one gold block, ×10 at four, 7.75 at the 48.3 kg midpoint", () => {
    expect(heavy(0)).toBe(1);
    expect(heavy(19.32)).toBe(1);
    expect(heavy(48.3)).toBeCloseTo(7.75, 12);
    expect(heavy(77.28)).toBe(10);
    expect(heavy(500)).toBe(10);
  });

  it("multiplies a row by the whole field's eased heaviness", () => {
    const gold = row("gold");
    const base = scoreFieldWithPassives(gold, [])[0]!;
    const scored = scoreFieldWithPassives(gold, [createPassiveBlock("heavy-stack", "h")])[0]!;
    // Five gold blocks: 96.6 kg, past the 77.28 kg cap.
    expect(scored.points / base.points).toBeCloseTo(10, 6);
  });

  it("does nothing for a field at or below one gold block's mass", () => {
    const wood = row("wood");
    const base = scoreFieldWithPassives(wood, [])[0]!;
    const scored = scoreFieldWithPassives(wood, [createPassiveBlock("heavy-stack", "h")])[0]!;
    expect(scored.points).toBe(base.points);
    expect(JSON.stringify(scored)).not.toContain("multiply-line-score-by-query");
  });

  it("is provisional: never in ordinary stock", () => {
    expect(ordinaryPassives().map(({ id }) => id)).not.toContain("heavy-stack");
  });
});
