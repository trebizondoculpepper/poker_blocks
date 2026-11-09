import { describe, expect, it } from "vite-plus/test";
import { lensClearance, pathPoint } from "./attract-scene";

describe("the attract sequence's paths (#147)", () => {
  it("never sends a card through the camera's axis", () => {
    // A path straight through the axis would pass through the lens and fill the screen with one
    // card. Every path must stay a minimum distance from it.
    const closest = Array.from({ length: 2000 }, (_, index) => {
      const { x, y } = pathPoint(() => (index * 0.6180339887) % 1);
      return Math.hypot(x, y);
    });
    // Against the real clearance, so lowering it to fit the view cannot quietly weaken the rule.
    expect(Math.min(...closest)).toBeGreaterThan(lensClearance - 0.001);
  });

  it("scatters the paths around the axis rather than lining them up", () => {
    const quadrants = new Set<string>();
    for (let index = 0; index < 400; index++) {
      const { x, y } = pathPoint(() => (index * 0.6180339887) % 1);
      quadrants.add(`${x < 0 ? "L" : "R"}${y < 0 ? "D" : "U"}`);
    }
    expect(quadrants.size).toBe(4);
  });
});
