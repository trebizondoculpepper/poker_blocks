import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { PlacedBlock } from "./game-state";
import { scoreFieldWithPassives } from "./passive-effects";
import { createPassiveBlock, ordinaryPassives } from "./passives";
import { packingPassives, scoreCurves } from "./trial-modifiers";

const sparse = (p: number) => scoreCurves.get("exponentRamp").factor(p, packingPassives.sparse);
const at = (block: CardBlock, x: number, y = 0, z = 0): PlacedBlock => ({
  block,
  cell: { x, y, z },
});
const line = () => standardDeck.slice(0, 5).map((card, x) => at(card, x));

describe("Sparse packing passive (#1071; doc/material-mass-and-passives.md)", () => {
  it("has no bonus at or above 20%, 1.15 at 15%, and caps at 1.3 at or below 10%", () => {
    expect(sparse(0.5)).toBe(1);
    expect(sparse(0.2)).toBe(1);
    expect(sparse(0.15)).toBeCloseTo(1.15, 12);
    expect(sparse(0.1)).toBeCloseTo(1.3, 12);
    expect(sparse(0.01)).toBeCloseTo(1.3, 12);
  });

  it("raises a row on a thinly spread field to the power 1.3", () => {
    // The line plus one block far above and behind it: 6 cells in a 5×5×5 box, 4.8% packed.
    const field = [...line(), at(standardDeck[10]!, 0, 4, 4)];
    const base = scoreFieldWithPassives(field, [])[0]!;
    const scored = scoreFieldWithPassives(field, [createPassiveBlock("sparse-packing", "s")])[0]!;
    expect(scored.points).toBe(Math.round(base.points ** 1.3));
  });

  it("does nothing for a fully packed field", () => {
    const field = line();
    const base = scoreFieldWithPassives(field, [])[0]!;
    const scored = scoreFieldWithPassives(field, [createPassiveBlock("sparse-packing", "s")])[0]!;
    expect(scored.points).toBe(base.points);
    expect(JSON.stringify(scored)).not.toContain("power-line-score-by-query");
  });

  it("is provisional, and offered in normal runs (#1393)", () => {
    expect(ordinaryPassives().map(({ id }) => id)).toContain("sparse-packing");
  });
});
