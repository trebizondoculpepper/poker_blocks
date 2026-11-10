import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { blockTitle, type BlockTitleConfig } from "./block-title";
import { danceTitleRow } from "../block-title-view";

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
