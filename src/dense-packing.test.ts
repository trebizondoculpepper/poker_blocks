import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { PlacedBlock } from "./game-state";
import { scoreFieldWithPassives } from "./passive-effects";
import { createPassiveBlock, ordinaryPassives } from "./passives";
import { packingPassives, scoreCurves, validateQueryFactor } from "./trial-modifiers";

const dense = (p: number) => scoreCurves.get("exponentRamp").factor(p, packingPassives.dense);
const at = (block: CardBlock, x: number, y = 0): PlacedBlock => ({ block, cell: { x, y, z: 0 } });
const line = () => standardDeck.slice(0, 5).map((card, x) => at(card, x));

describe("Dense packing passive (#1070; doc/material-mass-and-passives.md)", () => {
  it("has no bonus at or below 70%, then rises linearly to exponent 1.3 at 100%", () => {
    expect(dense(0.5)).toBe(1);
    expect(dense(0.7)).toBe(1);
    expect(dense(0.8)).toBeCloseTo(1.1, 12);
    expect(dense(0.9)).toBeCloseTo(1.2, 12);
    expect(dense(1)).toBeCloseTo(1.3, 12);
  });

  it("refuses exponents above 1.3 or degenerate thresholds", () => {
    const config = (params: unknown) => ({
      query: "packingDensity",
      value: "density",
      curve: "exponentRamp",
      params,
    });
    expect(validateQueryFactor("d", config(packingPassives.dense))).toEqual([]);
    expect(
      validateQueryFactor("d", config({ ...packingPassives.dense, maximum: 1.5 })),
    ).toHaveLength(1);
    expect(validateQueryFactor("d", config({ ...packingPassives.dense, cap: 0.7 }))).toHaveLength(
      1,
    );
  });

  it("raises a fully packed row to the power 1.3 in the power phase", () => {
    // A straight line fills its own bounding box: any shape qualifies.
    const field = line();
    const base = scoreFieldWithPassives(field, [])[0]!;
    const scored = scoreFieldWithPassives(field, [createPassiveBlock("dense-packing", "d")])[0]!;
    expect(scored.points).toBe(Math.round(base.points ** 1.3));
    expect(JSON.stringify(scored)).toContain("power-line-score-by-query");
  });

  it("does nothing for a sparse field", () => {
    // The line plus one far block: 6 cells in a 5×5 box, 24% packed.
    const field = [...line(), at(standardDeck[10]!, 0, 4)];
    const base = scoreFieldWithPassives(field, [])[0]!;
    const scored = scoreFieldWithPassives(field, [createPassiveBlock("dense-packing", "d")])[0]!;
    expect(scored.points).toBe(base.points);
    expect(JSON.stringify(scored)).not.toContain("power-line-score-by-query");
  });

  it("wears the exponential scoring colours, since it raises rather than multiplies", () => {
    expect(createPassiveBlock("dense-packing", "d").traits.scoringCategory).toEqual({
      operations: ["exponential"],
    });
  });

  it("is provisional, and offered in normal runs (#1393)", () => {
    expect(ordinaryPassives().map(({ id }) => id)).toContain("dense-packing");
  });
});
