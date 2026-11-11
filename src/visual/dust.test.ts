import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { blockEffects, createBlockEffects } from "./block-effects";
import { angularSpeed } from "./dust";
import "./dust";

const config = {
  effect: "dust",
  colour: 0x8a6a48,
  size: 0.05,
  opacity: 0.8,
  lifetime: 3,
  turbulence: 0,
  threshold: 1,
  proportionality: 20,
  launch: 2,
  drag: 4,
  terminal: 0.3,
  samples: 12,
  max: 64,
};
let seed = 1;
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function live(points: THREE.Points) {
  const alpha = points.geometry.getAttribute("puffAlpha");
  const position = points.geometry.getAttribute("position");
  return Array.from({ length: alpha.count }, (_, i) => i)
    .filter((i) => alpha.getX(i) > 0)
    .map((i) => new THREE.Vector3().fromBufferAttribute(position, i));
}

/** Turn `block` about `axis` at `speed` rad/s for `frames` frames of 1/60 s, updating dust. */
function spin(
  dust: ReturnType<typeof createBlockEffects>[number],
  block: THREE.Object3D,
  axis: THREE.Vector3,
  speed: number,
  frames: number,
) {
  for (let frame = 0; frame < frames; frame++) {
    block.rotateOnWorldAxis(axis, speed / 60);
    block.updateMatrixWorld(true);
    dust.update(1 / 60, block, false);
  }
}

describe("dust block effect (#465)", () => {
  it("measures angular speed on any axis", () => {
    const from = new THREE.Quaternion();
    for (const axis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 1).normalize()]) {
      const to = new THREE.Quaternion().setFromAxisAngle(axis, 0.5);
      expect(angularSpeed(from, to, 0.25)).toBeCloseTo(2, 5);
    }
  });

  it("releases nothing at or below the threshold, still or turning slowly", () => {
    const [dust] = createBlockEffects([config], { random, size: 1 });
    expect(blockEffects.has("dust")).toBe(true);
    const block = new THREE.Object3D();
    dust!.update(1 / 60, block, false);
    spin(dust!, block, new THREE.Vector3(0, 1, 0), 0.9, 120);
    expect(live(dust!.object as THREE.Points)).toHaveLength(0);
    dust!.dispose();
  });

  it("releases more the faster it turns above the threshold", () => {
    const count = (speed: number) => {
      const [dust] = createBlockEffects([{ ...config, lifetime: 100, max: 1000 }], {
        random,
        size: 1,
      });
      const block = new THREE.Object3D();
      dust!.update(1 / 60, block, false);
      spin(dust!, block, new THREE.Vector3(1, 0, 0), speed, 60);
      const n = live(dust!.object as THREE.Points).length;
      dust!.dispose();
      return n;
    };
    // One second: (2 − 1) × 20 = 20 grains; (5 − 1) × 20 = 80.
    expect(count(2)).toBeGreaterThanOrEqual(19);
    expect(count(2)).toBeLessThanOrEqual(21);
    expect(count(5)).toBeGreaterThan(count(2) * 3);
  });

  it("launches outward from the surface, then settles into a slow fall in world space", () => {
    const [dust] = createBlockEffects([{ ...config, lifetime: 100 }], { random, size: 1 });
    const block = new THREE.Object3D();
    block.position.set(3, 2, 0);
    block.updateMatrixWorld(true);
    dust!.update(1 / 60, block, false);
    spin(dust!, block, new THREE.Vector3(0, 0, 1), 6, 6);
    const born = live(dust!.object as THREE.Points);
    expect(born.length).toBeGreaterThan(0);
    // Near the surface: within the cube's half-diagonal of its centre, plus a little travel.
    for (const p of born) expect(p.distanceTo(block.position)).toBeLessThan(0.9 + 0.3);
    // Stop turning: the block holds still while grains fall at no more than the terminal speed.
    const heights = () => live(dust!.object as THREE.Points).map(({ y }) => y);
    for (let frame = 0; frame < 180; frame++) dust!.update(1 / 60, block, false);
    const before = heights();
    for (let frame = 0; frame < 60; frame++) dust!.update(1 / 60, block, false);
    const after = heights();
    after.forEach((y, i) => {
      const fell = before[i]! - y;
      expect(fell).toBeGreaterThan(0.25);
      expect(fell).toBeLessThan(0.32);
    });
    dust!.dispose();
  });

  it("is bounded by max and releases nothing under reduced motion", () => {
    const [dust] = createBlockEffects([{ ...config, max: 8, lifetime: 100 }], { random, size: 1 });
    const block = new THREE.Object3D();
    dust!.update(1 / 60, block, false);
    spin(dust!, block, new THREE.Vector3(0, 1, 0), 20, 60);
    expect(live(dust!.object as THREE.Points)).toHaveLength(8);
    const [still] = createBlockEffects([config], { random, size: 1 });
    still!.update(1 / 60, block, true);
    for (let frame = 0; frame < 60; frame++) {
      block.rotateY(20 / 60);
      block.updateMatrixWorld(true);
      still!.update(1 / 60, block, true);
    }
    expect(live(still!.object as THREE.Points)).toHaveLength(0);
    dust!.dispose();
    still!.dispose();
  });

  it("emits from the surface of a block drawn small and scaled up (one played from the hand)", () => {
    const [dust] = createBlockEffects([{ ...config, lifetime: 100, launch: 0 }], {
      random,
      size: 1,
    });
    const block = new THREE.Object3D();
    block.scale.setScalar(3);
    block.position.set(0, 5, 0);
    block.updateMatrixWorld(true);
    dust!.update(1 / 60, block, false);
    spin(dust!, block, new THREE.Vector3(0, 1, 0), 6, 1);
    const born = live(dust!.object as THREE.Points);
    expect(born.length).toBeGreaterThan(0);
    for (const p of born) expect(p.distanceTo(block.position)).toBeLessThanOrEqual(0.87);
    dust!.dispose();
  });
});
