import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { blockTitle, type BlockTitleConfig } from "./block-title";
import { danceTitleRow, precessTitleRow } from "../block-title-view";

describe("reusable block title", () => {
  it("owns separate scene instances and releases precisely the instance that exits", () => {
    const first = vi.fn();
    const second = vi.fn();
    const show = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const context = { services: { blockTitles: { show } } };
    const behaviour = blockTitle<typeof context>();
    const large: BlockTitleConfig = { text: "Poker Blocks", scale: 1 };
    const small: BlockTitleConfig = { ...large, scale: 0.5 };
    behaviour.enter!(context, large);
    behaviour.enter!(context, small);
    expect(show.mock.calls.map((call) => call[0].scale)).toEqual([1, 0.5]);
    behaviour.exit!(context, small);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    behaviour.exit!(context, large);
    behaviour.exit!(context, large);
    expect(first).toHaveBeenCalledTimes(1);
  });
  it("animates a rigid row and rests without music/reduced-motion energy", () => {
    const row = new THREE.Group();
    const letter = new THREE.Group();
    letter.position.set(2, 0, 0);
    row.add(letter);
    const config = { text: "Anything", scale: 1, dance: { bounce: 0.2, tilt: 4 } };
    danceTitleRow(row, 1, config, { phase: 0.25, energy: 1, tempo: 120 });
    expect(row.position.y).toBeCloseTo(1.2);
    expect(row.rotation.z).toBeCloseTo(THREE.MathUtils.degToRad(4));
    expect(letter.position.toArray()).toEqual([2, 0, 0]);
    danceTitleRow(row, 1, config, { phase: 0.25, energy: 0, tempo: 120 });
    expect(row.position.y).toBe(1);
    expect(row.rotation.z).toBe(0);
  });
});

describe("word precession", () => {
  const config = { text: "Poker Blocks", scale: 1 };
  const forward = (row: THREE.Group) => new THREE.Vector3(0, 0, 1).applyQuaternion(row.quaternion);
  it("traces a circle at constant depth and evenly spaces any number of words", () => {
    for (const count of [2, 3, 5]) {
      const rays = Array.from({ length: count }, (_, index) => {
        const row = new THREE.Group();
        row.position.set(1, 2, 3);
        precessTitleRow(row, 3, index, count, config, 1);
        expect(row.position.toArray()).toEqual([1, 2, 3]);
        return forward(row);
      });
      const angle = THREE.MathUtils.degToRad(7);
      for (const ray of rays) {
        expect(ray.z).toBeCloseTo(Math.cos(angle));
        expect(Math.hypot(ray.x / ray.z, ray.y / ray.z)).toBeCloseTo(Math.tan(angle));
      }
      const sum = rays.reduce((sum, ray) => sum.add(ray), new THREE.Vector3());
      expect(sum.x).toBeCloseTo(0);
      expect(sum.y).toBeCloseTo(0);
    }
  });
  it("completes its cycle and rests with zero motion energy", () => {
    const row = new THREE.Group();
    precessTitleRow(row, 0, 0, 2, config, 1);
    const start = forward(row);
    precessTitleRow(row, 16, 0, 2, config, 1);
    expect(forward(row).distanceTo(start)).toBeLessThan(1e-10);
    precessTitleRow(row, 4, 0, 2, config, 0);
    expect(forward(row).toArray()).toEqual([0, 0, 1]);
  });
});

it("allows live phase spacing to replace evenly spaced precession", () => {
  const config = { text: "Two Words", scale: 1, precession: { phaseDegrees: 90 } };
  const first = new THREE.Group();
  const second = new THREE.Group();
  precessTitleRow(first, 0, 0, 2, config, 1);
  precessTitleRow(second, 0, 1, 2, config, 1);
  const axis = new THREE.Vector3(0, 0, 1);
  const a = axis.clone().applyQuaternion(first.quaternion);
  const b = axis.clone().applyQuaternion(second.quaternion);
  expect(a.x).toBeGreaterThan(0);
  expect(a.y).toBeCloseTo(0);
  expect(b.x).toBeCloseTo(0);
  expect(b.y).toBeCloseTo(a.x);
});
