import { describe, expect, it } from "vite-plus/test";
import * as THREE from "three";
import { bloom, defaultDazzle, ghostLevel, ghostSeconds, inView, popPattern } from "./dazzle";

const sequence = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe("dazzle (#493)", () => {
  it("pops one to four circles, the first on the discharge and the rest strewn round it", () => {
    const one = popPattern(defaultDazzle, 1, sequence([0]));
    expect(one).toHaveLength(1);
    expect([one[0]!.dx, one[0]!.dy]).toEqual([0, 0]);
    const four = popPattern(defaultDazzle, 1, sequence([0.99, 0.5, 0.5, 0.5]));
    expect(four).toHaveLength(4);
    for (const circle of four.slice(1)) {
      const out = Math.hypot(circle.dx, circle.dy);
      expect(out).toBeGreaterThan(0);
      expect(out).toBeLessThanOrEqual(defaultDazzle.spread + 1e-9);
      expect(circle.frames).toBeGreaterThanOrEqual(1);
      expect(circle.frames).toBeLessThanOrEqual(3);
    }
  });

  it("sizes circles by strength, and never exceeds the configured count", () => {
    const strong = popPattern(defaultDazzle, 1, sequence([0, 0.5]))[0]!.radius;
    const weak = popPattern(defaultDazzle, 0, sequence([0, 0.5]))[0]!.radius;
    expect(strong).toBeGreaterThan(weak);
    const capped = popPattern({ circles: 2, spread: 0.09 }, 1, sequence([0.99, 0.5]));
    expect(capped.length).toBeLessThanOrEqual(2);
  });

  it("blooms out quickly and fully, and afterimages fade from dark to gone", () => {
    expect(bloom(1, 3)).toBeGreaterThan(1 / 3);
    expect(bloom(3, 3)).toBe(1);
    expect(ghostLevel(0, 7)).toBe(1);
    expect(ghostLevel(3.5, 7)).toBeGreaterThan(0);
    expect(ghostLevel(3.5, 7)).toBeLessThan(1);
    expect(ghostLevel(7, 7)).toBe(0);
  });

  it("lets afterimages last about their mean, never under the minimum", () => {
    expect(ghostSeconds(defaultDazzle.ghost, sequence([1e-12, 0]))).toBeGreaterThanOrEqual(
      defaultDazzle.ghost.min,
    );
    expect(ghostSeconds(defaultDazzle.ghost, sequence([Math.exp(-0.5), 0.25]))).toBeCloseTo(
      defaultDazzle.ghost.mean,
    );
  });

  it("is flash-safe by default: the glare is capped, and much softer under reduced motion", () => {
    expect(defaultDazzle.glare.max).toBeLessThanOrEqual(0.8);
    expect(defaultDazzle.glare.reduced).toBeLessThan(defaultDazzle.glare.max / 2);
    expect(defaultDazzle.maxGhosts).toBeGreaterThan(0);
    expect(defaultDazzle.sound).toBe("block.dazzle_pop");
  });

  it("dazzles only for points inside the camera's depth range (#535 review)", () => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
    camera.updateMatrixWorld();
    const project = (z: number) => new THREE.Vector3(0, 0, z).project(camera);
    expect(inView(project(-5))).toBe(true);
    expect(inView(project(1))).toBe(false);
    expect(inView(project(-80))).toBe(false);
  });
});
