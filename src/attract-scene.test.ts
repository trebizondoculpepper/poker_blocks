import { describe, expect, it } from "vite-plus/test";
import {
  defaultAttractTuning,
  depthOpacity,
  equalMaterialWeights,
  fadedInZ,
  lensClearance,
  pathPoint,
  pickMaterial,
  spawnZ,
  type MaterialWeight,
} from "./attract-scene";
import { blockMaterials } from "./materials";

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

describe("attract cards fade in with depth", () => {
  it("spawns at -40 and is fully faded in by -35", () => {
    expect(spawnZ).toBe(-40);
    expect(fadedInZ).toBe(-35);
  });

  it("is invisible at the spawn, opaque from -35 on, and eases in between", () => {
    expect(depthOpacity(spawnZ)).toBe(0);
    expect(depthOpacity(spawnZ - 5)).toBe(0);
    expect(depthOpacity(fadedInZ)).toBe(1);
    expect(depthOpacity(0)).toBe(1);
    expect(depthOpacity(-37.5)).toBeCloseTo(0.5);
    // Eased: slow at both ends, so a quarter of the way in is well under a quarter opaque.
    expect(depthOpacity(-38.75)).toBeLessThan(0.25);
    expect(depthOpacity(-36.25)).toBeGreaterThan(0.75);
  });
});

describe("attract cards come in every material, by weight", () => {
  /** A deterministic sequence spread evenly over [0, 1). */
  const evenly = (count: number) => {
    let index = 0;
    return () => (index++ % count) / count + 0.5 / count;
  };

  it("uses every material, equally, by default", () => {
    expect(defaultAttractTuning.materialWeights).toEqual(equalMaterialWeights);
    const random = evenly(blockMaterials.length * 10);
    const counts = new Map<string, number>();
    for (let draw = 0; draw < blockMaterials.length * 10; draw++) {
      const material = pickMaterial(equalMaterialWeights, random);
      counts.set(material, (counts.get(material) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([...blockMaterials].sort());
    expect(new Set(counts.values())).toEqual(new Set([10]));
  });

  it("follows the weights, and leaves out a material weighted 0", () => {
    const weights: MaterialWeight[] = [
      { material: "steel", weight: 3 },
      { material: "wood", weight: 1 },
      { material: "paper", weight: 0 },
    ];
    const random = evenly(400);
    const drawn = Array.from({ length: 400 }, () => pickMaterial(weights, random));
    expect(new Set(drawn)).toEqual(new Set(["steel", "wood"]));
    expect(drawn.filter((material) => material === "steel")).toHaveLength(300);
  });

  it("falls back to paper when no material has any weight", () => {
    const none = equalMaterialWeights.map(({ material }) => ({ material, weight: 0 }));
    expect(pickMaterial(none, () => 0.5)).toBe("paper");
  });
});
