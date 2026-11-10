import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { createScatterPlacer, scatterCounts, scatterSpots, spotSize } from "./shop-scatter";

describe("shop scatter (#122)", () => {
  it("has an arrangement for every supported stock size, 5 to 9", () => {
    expect(scatterCounts).toEqual([5, 6, 7, 8, 9]);
  });

  for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    it(`places ${count} offers without overlap, inside the circle`, () => {
      const spots = scatterSpots(count);
      expect(spots).toHaveLength(count);
      for (const [i, a] of spots.entries()) {
        // The square's far corner stays inside the circle.
        expect(Math.hypot(a.x, a.y)).toBeLessThanOrEqual(1 - spotSize / Math.SQRT2);
        // Squares overlap unless they are a full width apart across or down.
        for (const b of spots.slice(i + 1)) {
          expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeGreaterThanOrEqual(
            spotSize,
          );
        }
      }
    });
  }

  it("keeps each remaining offer on its spot after a purchase, and lays out a new stock afresh", () => {
    const place = createScatterPlacer();
    const first = place(["a", "b", "c", "d", "e", "f"]);
    const after = place(["a", "c", "d", "e", "f"]);
    for (const id of ["a", "c", "d", "e", "f"]) expect(after.get(id)).toEqual(first.get(id));
    const restocked = place(["v", "w", "x", "y", "z"]);
    expect([...restocked.values()]).toEqual(scatterSpots(5));
  });

  it("gives each offer a touch target of at least 44px at the smallest stock area", () => {
    const css = readFileSync(new URL("./shop-view.css", import.meta.url), "utf8");
    const smallest = Number(/--scatter-min:\s*(\d+)px/.exec(css)?.[1]);
    // The area is two radii across, and an offer is spotSize radii wide.
    expect((smallest / 2) * spotSize).toBeGreaterThanOrEqual(44);
  });
});
