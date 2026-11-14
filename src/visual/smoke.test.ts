import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { blockEffects, createBlockEffects } from "./block-effects";
import { createSmokeBurst } from "./smoke";

const config = {
  effect: "smoke",
  colour: 0x777777,
  size: 0.3,
  frequency: 10,
  rise: 1,
  lifetime: 2,
  turbulence: 0.2,
  opacity: 0.5,
};
const random = () => 0.5;

function live(points: THREE.Points) {
  const position = points.geometry.getAttribute("position");
  const alpha = points.geometry.getAttribute("puffAlpha");
  return Array.from({ length: alpha.count }, (_, i) => i)
    .filter((i) => alpha.getX(i) > 0)
    .map((i) => new THREE.Vector3().fromBufferAttribute(position, i));
}

describe("smoke block effect (#464)", () => {
  it("is a registered block effect a look can list", () => {
    expect(blockEffects.has("smoke")).toBe(true);
    const [smoke] = createBlockEffects([config], { random, size: 1 });
    expect(smoke!.object).toBeInstanceOf(THREE.Points);
    smoke!.dispose();
  });

  it("emits from the block's world centre and rises along world up, whatever its turn", () => {
    const [smoke] = createBlockEffects([config], { random, size: 1 });
    const parent = new THREE.Group();
    parent.position.set(5, 0, 0);
    parent.rotation.set(Math.PI, 0, Math.PI / 3); // upside down and turned
    const block = new THREE.Object3D();
    block.position.set(0, 1, 0);
    parent.add(block);
    parent.updateMatrixWorld(true);
    const centre = block.getWorldPosition(new THREE.Vector3());
    smoke!.update(0.1, block, false);
    const [first] = live(smoke!.object as THREE.Points);
    // Born when the first puff fell due (0.1 s at 10 a second): at the centre, not yet risen.
    expect(first!.y).toBeCloseTo(centre.y, 3);
    smoke!.update(0.5, block, false);
    const risen = live(smoke!.object as THREE.Points);
    expect(Math.max(...risen.map(({ y }) => y))).toBeGreaterThan(centre.y + 0.3);
    // Sideways drift stays within the turbulence.
    for (const p of risen) {
      expect(Math.abs(p.x - centre.x)).toBeLessThanOrEqual(0.2 * 0.5 + 1e-6);
      expect(Math.abs(p.z - centre.z)).toBeLessThanOrEqual(0.2 * 0.5 + 1e-6);
    }
    smoke!.dispose();
  });

  it("leaves emitted puffs behind when the block moves; only new ones follow it", () => {
    const [smoke] = createBlockEffects([config], { random, size: 1 });
    const block = new THREE.Object3D();
    block.updateMatrixWorld(true);
    smoke!.update(0.1, block, false);
    const before = live(smoke!.object as THREE.Points).map(({ x }) => x);
    block.position.set(10, 0, 0);
    block.updateMatrixWorld(true);
    smoke!.update(0.1, block, false);
    const xs = live(smoke!.object as THREE.Points).map(({ x }) => x);
    expect(xs.some((x) => Math.abs(x) < 1)).toBe(true);
    expect(xs.some((x) => x > 9)).toBe(true);
    expect(before.length).toBeGreaterThan(0);
    smoke!.dispose();
  });

  it("puffs born within one frame get their own ages, and none is aged before it is born", () => {
    const [smoke] = createBlockEffects([{ ...config, frequency: 40, lifetime: 0.08 }], {
      random,
      size: 1,
    });
    const block = new THREE.Object3D();
    smoke!.update(0.1, block, false);
    const heights = live(smoke!.object as THREE.Points).map(({ y }) => y);
    expect(heights).toHaveLength(4);
    expect(new Set(heights.map((y) => y.toFixed(4))).size).toBe(4);
    smoke!.dispose();
  });

  it("is bounded, carries low rates over, and emits nothing under reduced motion", () => {
    const [smoke] = createBlockEffects([{ ...config, frequency: 3 }], { random, size: 1 });
    const block = new THREE.Object3D();
    for (let frame = 0; frame < 6; frame++) smoke!.update(1 / 60, block, false);
    expect(live(smoke!.object as THREE.Points)).toHaveLength(0);
    for (let frame = 0; frame < 20; frame++) smoke!.update(1 / 60, block, false);
    expect(live(smoke!.object as THREE.Points)).toHaveLength(1);
    for (let frame = 0; frame < 600; frame++) smoke!.update(1 / 60, block, false);
    const count = (smoke!.object as THREE.Points).geometry.getAttribute("puffAlpha").count;
    expect(count).toBe(Math.ceil(3 * 2) + 2);
    const [still] = createBlockEffects([config], { random, size: 1 });
    still!.update(1, block, true);
    expect(live(still!.object as THREE.Points)).toHaveLength(0);
    smoke!.dispose();
    still!.dispose();
  });
});

describe("smoke burst (#510)", () => {
  // 7.5 units: half a second.
  const burst = { ...config, emitUnits: 7.5 };
  const at = new THREE.Vector3(2, 1, -3);

  it("puffs from its point for a bounded time, then finishes once the last puff has gone", () => {
    const smoke = createSmokeBurst(burst, { random, size: 1 }, at);
    expect(smoke.update(0.1, false)).toBe(true);
    const first = live(smoke.object as THREE.Points);
    expect(first.length).toBeGreaterThan(0);
    for (const puff of first) {
      expect(puff.x).toBeCloseTo(at.x, 0);
      expect(puff.y).toBeGreaterThanOrEqual(at.y);
    }
    for (let t = 0.1; t < 0.6; t += 0.1) smoke.update(0.1, false);
    // Emission has stopped: no more puffs than half a second's worth.
    const most = Math.ceil(burst.frequency * 0.5) + 1;
    expect(live(smoke.object as THREE.Points).length).toBeLessThanOrEqual(most);
    let running = true;
    let steps = 0;
    while (running && steps++ < 100) running = smoke.update(0.1, false);
    expect(running).toBe(false);
    // At most the emission plus lifetime: 2.5 s, here in 0.1 s steps.
    expect(steps).toBeLessThanOrEqual(21);
    expect(live(smoke.object as THREE.Points)).toEqual([]);
    smoke.dispose();
  });

  it("emits nothing and finishes at once under reduced motion", () => {
    const smoke = createSmokeBurst(burst, { random, size: 1 }, at);
    expect(smoke.update(0.016, true)).toBe(false);
    expect(live(smoke.object as THREE.Points)).toEqual([]);
    smoke.dispose();
  });
});
