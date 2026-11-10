import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { blockTitle, type BlockTitleConfig } from "./block-title";
import { beatShapes, bouncePhase } from "../dance/beat-shapes";
import {
  bounceDirection,
  bounceJitter,
  bounceTitleBlock,
  restTurn,
  precessTitleRow,
  tiltTitleRow,
} from "../block-title-view";

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
    const rest = new THREE.Vector3(0, 1, 0);
    const up = new THREE.Vector3(0, 1, 0);
    // A quarter through the tilt's cycle: tilted fully; halfway through the bounce's: at the top.
    tiltTitleRow(row, config, { phase: 0.25, energy: 1, tempo: 120 });
    bounceTitleBlock(row, rest, up, config, { phase: 0.5, energy: 1, tempo: 120 });
    expect(row.position.y).toBeCloseTo(1.2);
    expect(row.rotation.z).toBeCloseTo(THREE.MathUtils.degToRad(4));
    expect(letter.position.toArray()).toEqual([2, 0, 0]);
    // The bounce touches down at the start of its cycle (the downbeat, on a bar cycle).
    bounceTitleBlock(row, rest, up, config, { phase: 0, energy: 1, tempo: 120 });
    expect(row.position.y).toBeCloseTo(1);
    // A configured beat shape: \`pulse\` hits at the start of its cycle and dies away.
    const pulsing = { ...config, dance: { ...config.dance, bounceShape: "pulse" } };
    bounceTitleBlock(row, rest, up, pulsing, { phase: 0, energy: 1, tempo: 120 });
    expect(row.position.y).toBeCloseTo(1.2);
    bounceTitleBlock(row, rest, up, pulsing, { phase: 0.9, energy: 1, tempo: 120 });
    expect(row.position.y).toBeLessThan(1.001);
    tiltTitleRow(row, config, { phase: 0.25, energy: 0, tempo: 120 });
    bounceTitleBlock(row, rest, up, config, { phase: 0.5, energy: 0, tempo: 120 });
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

describe("the title's bounce shaping", () => {
  const envelope = beatShapes.get("envelope");
  it("eases an envelope up over its attack and down over the rest, smooth at both ends", () => {
    expect(envelope(0, 0.3)).toBe(0);
    expect(envelope(0.3, 0.3)).toBeCloseTo(1);
    expect(envelope(1, 0.3)).toBeCloseTo(0);
    expect(envelope(0.15, 0.3)).toBeCloseTo(0.5);
    expect(envelope(0.65, 0.3)).toBeCloseTo(0.5);
    // With the default attack (0.5) it is the raised-cosine bump, `sine`.
    for (const phase of [0.1, 0.4, 0.7])
      expect(envelope(phase)).toBeCloseTo(beatShapes.get("sine")(phase));
  });

  it("windows the bump so it peaks on the downbeat and rests flat either side", () => {
    // A bump over 3/4 of the bar, peaking a third of the way through.
    const lift = (phase: number) => envelope(bouncePhase(phase, 0.75, 1 / 3), 1 / 3);
    expect(lift(0)).toBeCloseTo(1);
    // It began a quarter of the bar before the downbeat and ends half a bar after it.
    expect(lift(0.76)).toBeCloseTo(0, 2);
    expect(lift(0.5)).toBeCloseTo(0);
    expect(lift(0.6)).toBe(0);
    expect(lift(0.25)).toBeGreaterThan(0.4);
    // No window: the shape over the whole cycle, as before.
    expect(bouncePhase(0.3)).toBe(0.3);
  });
});

describe("messy bounces", () => {
  const config = { text: "Poker", scale: 1, dance: { bounceAngleSpread: 10 } };
  it("bounces straight up with no angle spread, whatever the block's jitter", () => {
    const jitter = { time: 1.5, leanX: -2, leanZ: 0.7, turn: [0, 0, 0] as const };
    const straight = bounceDirection({ ...config, dance: {} }, jitter);
    expect(straight.toArray().map((value) => +value.toFixed(9))).toEqual([0, 1, 0]);
  });
  it("leans each block off vertical by its jitter times the spread, keeping the lift's length", () => {
    const direction = bounceDirection(config, { time: 0, leanX: 0, leanZ: 1, turn: [0, 0, 0] });
    expect(direction.length()).toBeCloseTo(1);
    expect(THREE.MathUtils.radToDeg(direction.angleTo(new THREE.Vector3(0, 1, 0)))).toBeCloseTo(10);
  });
  it("draws normally distributed jitter, centred on a perfect bounce", () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const times = Array.from({ length: 4000 }, () => bounceJitter(random).time);
    const mean = times.reduce((sum, value) => sum + value, 0) / times.length;
    const deviation = Math.sqrt(
      times.reduce((sum, value) => sum + (value - mean) ** 2, 0) / times.length,
    );
    expect(Math.abs(mean)).toBeLessThan(0.06);
    expect(deviation).toBeCloseTo(1, 1);
  });
});

describe("resting disorder", () => {
  it("turns each block from its rest by its own jitter times the spread, and not at all at 0", () => {
    const block = new THREE.Object3D();
    const rest = new THREE.Euler(0, 0.1, 0);
    const jitter = { time: 0, leanX: 0, leanZ: 0, turn: [1, -2, 0.5] as const };
    restTurn(block, rest, { text: "P", scale: 1, dance: { restAngleSpread: 2 } }, jitter);
    const degrees = (radians: number) => THREE.MathUtils.radToDeg(radians);
    expect(degrees(block.rotation.x)).toBeCloseTo(2);
    expect(degrees(block.rotation.y - 0.1)).toBeCloseTo(-4);
    expect(degrees(block.rotation.z)).toBeCloseTo(1);
    restTurn(block, rest, { text: "P", scale: 1 }, jitter);
    expect(block.rotation.toArray().slice(0, 3)).toEqual([0, 0.1, 0]);
  });
});
