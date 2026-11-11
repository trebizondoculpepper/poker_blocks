import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { blockEffects, createBlockEffects } from "./block-effects";
import "./smoke";

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
    // Born at the centre, then risen for the rest of that frame (0.1 s at 1 block a second).
    expect(first!.y).toBeCloseTo(centre.y + 0.1, 3);
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
