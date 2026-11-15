import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { Block } from "../core/block";
import { ambientPrecession } from "./ambient-precession";
import { interactionFeedback } from "./interaction-feedback";

function mounted(settings: Partial<typeof ambientPrecession.defaults> = {}) {
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.set(0.5, 0, 0);
  outer.add(inner);
  const block = new Block("cube");
  block.add(ambientPrecession, settings);
  block.add(interactionFeedback);
  block.emit("presentation.mount", { object: inner, materials: [] });
  const node = inner.parent!;
  return { outer, inner, node, block };
}

const restQuaternion = () =>
  new THREE.Quaternion().setFromEuler(
    new THREE.Euler(THREE.MathUtils.degToRad(8), THREE.MathUtils.degToRad(-12), 0),
  );

describe("ambient precession (#1075)", () => {
  it("slots its own node between the outer placement and the inner feedback node", () => {
    const { outer, inner, node } = mounted();
    expect(node.name).toBe("ambientPrecession");
    expect(node.parent).toBe(outer);
    expect(inner.parent).toBe(node);
    // The inner node's place moves to the precession node, so nothing shifts.
    expect(node.position.x).toBe(0.5);
    expect(inner.position.x).toBe(0);
  });

  it("turns about all three axes, bounded around the readable rest pose, never drifting", () => {
    const { node, block } = mounted();
    const rest = restQuaternion();
    const angles: number[] = [];
    for (let frame = 0; frame < 60 * 30; frame++) {
      block.update(1 / 60);
      angles.push(node.quaternion.angleTo(rest));
    }
    // Moves, but never more than the amplitudes combined (4 + 6 + 2 degrees).
    expect(Math.max(...angles)).toBeGreaterThan(THREE.MathUtils.degToRad(2));
    expect(Math.max(...angles)).toBeLessThanOrEqual(THREE.MathUtils.degToRad(12) + 1e-9);
  });

  it("holds the rest pose under reduced motion", () => {
    const { node, block } = mounted({ reducedMotion: true });
    for (let frame = 0; frame < 120; frame++) block.update(1 / 60);
    expect(node.quaternion.angleTo(restQuaternion())).toBeLessThan(1e-6);
  });

  it("leaves the inner node's own transform to the feedback trait", () => {
    const { inner, block } = mounted();
    block.emit("interaction.state", { enabled: true, hovered: true, pressed: false });
    for (let frame = 0; frame < 60; frame++) block.update(1 / 60);
    // Feedback scaled the inner node; precession wrote only its own.
    expect(inner.scale.x).toBeGreaterThan(1);
    expect(inner.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
  });

  it("unwraps its node on disposal, restoring the inner node's place", () => {
    const { outer, inner, node, block } = mounted();
    block.dispose();
    expect(inner.parent).toBe(outer);
    expect(inner.position.x).toBe(0.5);
    expect(node.parent).toBeNull();
  });
});
