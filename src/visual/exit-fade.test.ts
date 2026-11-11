import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { createExitRunner, type ExitVisual } from "./exit-presentation";
import "./exit-fade";

function visual() {
  const shellMaterial = new THREE.MeshStandardMaterial({ opacity: 1 });
  const contentsMaterial = new THREE.MeshBasicMaterial({ opacity: 0.8, transparent: true });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(), shellMaterial);
  const contents = new THREE.Mesh(new THREE.BoxGeometry(), contentsMaterial);
  const root = new THREE.Group();
  root.add(shell, contents);
  new THREE.Group().add(root);
  const released = vi.fn();
  const v: ExitVisual = { root, shell: [shell], contents: [contents], release: released };
  return { v, shell, contents, shellMaterial, contentsMaterial, released };
}
const snapshot = { blockId: "b1" };
const opacity = (mesh: THREE.Mesh) => (mesh.material as THREE.Material).opacity;

describe("fade exit effect (#440)", () => {
  it("fades its target to nothing over its configured time, on private copies of its materials", () => {
    const { v, shell, contents, shellMaterial } = visual();
    const runner = createExitRunner();
    runner.start(snapshot, v, {
      steps: [{ effects: [{ effect: "fade", target: "shell", config: { seconds: 1 } }] }],
    });
    expect(shell.material).not.toBe(shellMaterial);
    runner.update(0.5);
    expect(opacity(shell)).toBeCloseTo(0.5);
    // The shared original and the untargeted contents are untouched.
    expect(shellMaterial.opacity).toBe(1);
    expect(opacity(contents)).toBe(0.8);
    runner.update(0.5);
    expect(runner.active).toBe(0);
  });

  it("can fade only a contained block's contents, from their own opacity", () => {
    const { v, contents, shell, shellMaterial } = visual();
    const runner = createExitRunner();
    runner.start(snapshot, v, {
      steps: [{ effects: [{ effect: "fade", target: "contents", config: { seconds: 1 } }] }],
    });
    runner.update(0.25);
    expect(opacity(contents)).toBeCloseTo(0.6);
    expect(shell.material).toBe(shellMaterial);
    runner.dispose();
  });

  it("puts the original materials back and frees its copies when it ends, before the release", () => {
    const { v, shell, shellMaterial, released } = visual();
    const runner = createExitRunner();
    runner.start(snapshot, v, {
      steps: [{ effects: [{ effect: "fade", config: { seconds: 0.2 } }] }],
    });
    const copy = shell.material as THREE.Material;
    const freed = vi.spyOn(copy, "dispose");
    runner.update(0.3);
    expect(shell.material).toBe(shellMaterial);
    expect(freed).toHaveBeenCalledTimes(1);
    expect(released).toHaveBeenCalledTimes(1);
  });

  it("ends at once under reduced motion, and on cancellation", () => {
    const reduced = visual();
    const runner = createExitRunner(() => true);
    runner.start(snapshot, reduced.v, { steps: [{ effects: [{ effect: "fade" }] }] });
    expect(opacity(reduced.shell)).toBe(0);
    runner.update(0.016);
    expect(runner.active).toBe(0);
    const cancelled = visual();
    const other = createExitRunner();
    other.start(snapshot, cancelled.v, { steps: [{ effects: [{ effect: "fade" }] }] });
    other.cancel("b1");
    expect(cancelled.shell.material).toBe(cancelled.shellMaterial);
    expect(cancelled.released).toHaveBeenCalledTimes(1);
  });
});
