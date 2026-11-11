import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { Block } from "../core/block";
import { advanceSpring, createSpringAnchor } from "./spring-anchor";

/** A block on a spring at (2, 1, 0), with a seeded random source for its messiness. */
function anchored(settings: Record<string, number | boolean> = {}) {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const block = new Block("spring");
  block.add(createSpringAnchor(random), settings);
  const object = new THREE.Group();
  object.position.set(2, 1, 0);
  block.emit("anchor.mount", { object });
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) block.update(1 / 60);
  };
  return { block, object, run };
}

describe("spring anchor (#347)", () => {
  it("wobbles past its rest point after a kick, then settles: a damped oscillation", () => {
    const position = new THREE.Vector3(0, 0, 0);
    const velocity = new THREE.Vector3(0, 2, 0);
    const rest = new THREE.Vector3();
    let highest = 0;
    let lowest = 0;
    for (let frame = 0; frame < 240; frame++) {
      advanceSpring(position, velocity, rest, 70, 5, 1 / 60);
      highest = Math.max(highest, position.y);
      lowest = Math.min(lowest, position.y);
    }
    expect(highest).toBeGreaterThan(0.1);
    // Underdamped: it swings back through the rest point to the other side.
    expect(lowest).toBeLessThan(-0.02);
    expect(Math.abs(position.y)).toBeLessThan(1e-3);
  });

  it("returns exactly home with no messiness", () => {
    const { block, object, run } = anchored({ restJitter: 0, tiltJitter: 0, scatter: 0 });
    block.emit("spring.kick", { y: 1.5 });
    run(0.1);
    expect(object.position.y).toBeGreaterThan(1.05);
    run(4);
    expect(object.position.distanceTo(new THREE.Vector3(2, 1, 0))).toBeLessThan(1e-3);
    expect(Math.abs(object.rotation.z)).toBeLessThan(1e-3);
  });

  it("settles a little away from home after each kick, by its messiness, never drifting off", () => {
    const { block, object, run } = anchored({ restJitter: 0.05, tiltJitter: 3 });
    const home = new THREE.Vector3(2, 1, 0);
    const rests: THREE.Vector3[] = [];
    for (let kick = 0; kick < 20; kick++) {
      block.emit("spring.kick", { y: 1 });
      run(4);
      rests.push(object.position.clone());
    }
    // Not where it started, and not the same place twice...
    expect(rests.some((rest) => rest.distanceTo(home) > 0.01)).toBe(true);
    expect(new Set(rests.map(({ x }) => x.toFixed(4))).size).toBeGreaterThan(10);
    // ...but always near home: each rest is drawn around home, not around the last one.
    expect(Math.max(...rests.map((rest) => rest.distanceTo(home)))).toBeLessThan(0.3);
    expect(Math.abs(THREE.MathUtils.radToDeg(object.rotation.z))).toBeLessThan(15);
  });

  it("is kicked up by hover and down by a press", () => {
    const hovered = anchored({ restJitter: 0, scatter: 0 });
    hovered.block.emit("input.enter");
    hovered.run(0.08);
    expect(hovered.object.position.y).toBeGreaterThan(1);
    const pressed = anchored({ restJitter: 0, scatter: 0 });
    pressed.block.emit("input.press");
    pressed.run(0.08);
    expect(pressed.object.position.y).toBeLessThan(1);
  });

  it("holds still at home with reduced motion", () => {
    const { block, object, run } = anchored({ reducedMotion: true });
    block.emit("spring.kick", { y: 3, spin: 2 });
    block.emit("input.press");
    run(0.5);
    expect(object.position.toArray()).toEqual([2, 1, 0]);
    expect(object.rotation.z).toBe(0);
  });
});
