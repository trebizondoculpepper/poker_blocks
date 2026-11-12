import { describe, expect, it } from "vite-plus/test";
import { gameModeFor } from "../../game-modes";
import { opticsBackends } from "../../visual/optics-backends";
import { comparisonLayout, distribution, pinchDistance } from "./room";

describe("the crystal comparison room (#524)", () => {
  it("lays out the same cards, places and turns for a seed", () => {
    const a = comparisonLayout(9, 524);
    const b = comparisonLayout(9, 524);
    expect(a.map(({ card }) => card)).toEqual(b.map(({ card }) => card));
    expect(a.map(({ position }) => position.toArray())).toEqual(
      b.map(({ position }) => position.toArray()),
    );
    expect(a.map(({ rotation }) => rotation.toArray())).toEqual(
      b.map(({ rotation }) => rotation.toArray()),
    );
    expect(comparisonLayout(9, 525).map(({ card }) => card)).not.toEqual(a.map(({ card }) => card));
  });

  it("is a developer mode offering only registered backends", () => {
    const scene = gameModeFor("dev17").scenes.find(({ id }) => id === "dev17/crystal-comparison");
    const config = scene?.traits.devCrystalComparison;
    expect(config?.backends).toEqual(["current", "approximation"]);
    for (const name of config!.backends) expect(opticsBackends.has(name)).toBe(true);
    expect(gameModeFor("dev17").traits.console).toEqual({ name: "dev17" });
  });

  it("reports frame-time median and p95", () => {
    expect(distribution([4, 1, 3, 2])).toEqual({ median: 2, p95: 4, samples: 4 });
    expect(distribution([])).toEqual({ median: 0, p95: 0, samples: 0 });
  });
});

describe("pinch zoom in the comparison room (#637 review)", () => {
  it("depends only on the finger-spacing ratio, not how many events arrive", () => {
    // Doubling the spacing halves the distance, in one event or in ten.
    expect(pinchDistance(10, 100, 200)).toBe(5);
    let last = 10;
    for (let step = 1; step <= 10; step++) last = pinchDistance(10, 100, 100 + step * 10);
    expect(last).toBe(5);
  });
});
