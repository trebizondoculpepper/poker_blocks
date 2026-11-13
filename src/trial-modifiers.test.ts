import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { PlacedBlock } from "./game-state";
import { scoreFieldWithPassives } from "./passive-effects";
import { createPassiveBlock, ordinaryPassives } from "./passives";
import { packingTrials, scoreCurves, validateQueryFactor } from "./trial-modifiers";

const placed = (block: CardBlock, x: number, y = 0): PlacedBlock => ({
  block,
  cell: { x, y, z: 0 },
});
const dense = (d: number) => scoreCurves.get("denseRamp").factor(d, packingTrials.dense);
const sparse = (d: number) => scoreCurves.get("sparseRamp").factor(d, packingTrials.sparse);

describe("dense and sparse packing trials (#817)", () => {
  it("matches the documented sample values", () => {
    expect(dense(0.5)).toBe(1);
    expect(sparse(0.5)).toBe(1);
    expect(dense(0.85)).toBeCloseTo(5.5, 12);
    expect(sparse(0.1)).toBeCloseTo(5.5, 12);
    expect(dense(1)).toBe(10);
    expect(sparse(0)).toBe(10);
  });

  it("rejects invalid curve parameters before they can score", () => {
    const factor = (params: unknown) => ({
      query: "packingDensity",
      value: "density",
      curve: "denseRamp",
      params,
    });
    expect(validateQueryFactor("t", factor({ maximum: 0.5, start: 0.7 }))).toHaveLength(1);
    expect(validateQueryFactor("t", factor({ maximum: 10, start: 1 }))).toHaveLength(1);
    expect(validateQueryFactor("t", factor({ maximum: Number.NaN, start: 0.5 }))).toHaveLength(1);
    expect(
      validateQueryFactor("t", { ...factor(packingTrials.dense), curve: "nope" }),
    ).toHaveLength(1);
    expect(validateQueryFactor("t", factor(packingTrials.dense))).toEqual([]);
  });

  it("multiplies each scored row by the field's packing factor, once per installed copy", () => {
    // A filled line: density 1, so Dense is ×10 and Sparse ×1.
    const line = standardDeck.slice(0, 5).map((card, x) => placed(card, x));
    const base = scoreFieldWithPassives(line, [])[0]!.points;
    expect(base).toBeGreaterThan(0);
    const withDense = scoreFieldWithPassives(line, [
      createPassiveBlock("trial-dense-packing", "d1"),
    ]);
    expect(withDense[0]!.points).toBe(Math.round(base * 10));
    const withSparse = scoreFieldWithPassives(line, [
      createPassiveBlock("trial-sparse-packing", "s1"),
    ]);
    expect(withSparse[0]!.points).toBe(base);
    // Two copies stack through ordinary composition.
    const twice = scoreFieldWithPassives(line, [
      createPassiveBlock("trial-dense-packing", "d1"),
      createPassiveBlock("trial-dense-packing", "d2"),
    ]);
    expect(twice[0]!.points).toBe(Math.round(base * 100));
  });

  it("sees the whole field, outliers included", () => {
    const line = standardDeck.slice(0, 5).map((card, x) => placed(card, x));
    // A far outlier drops the density below the sparse threshold: 6 cells in a 13×13 box.
    const field = [...line, placed(standardDeck[20]!, 12, 12)];
    const base = scoreFieldWithPassives(field, [])[0]!.points;
    const scored = scoreFieldWithPassives(field, [
      createPassiveBlock("trial-sparse-packing", "s1"),
    ]);
    const d = 6 / (13 * 13);
    expect(scored[0]!.points).toBe(Math.round(base * sparse(d)));
  });

  it("is provisional: never in normal play's passive catalogue", () => {
    const ordinary = ordinaryPassives().map(({ id }) => id);
    expect(ordinary).not.toContain("trial-dense-packing");
    expect(ordinary).not.toContain("trial-sparse-packing");
  });
});
