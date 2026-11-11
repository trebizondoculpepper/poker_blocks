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

describe("fade exit effect (#440)", () => {
  it("fades its target to nothing over its configured time", () => {
    const { v, shellMaterial, contentsMaterial } = visual();
    const runner = createExitRunner();
    runner.start(snapshot, v, {
      steps: [{ effects: [{ effect: "fade", target: "shell", config: { seconds: 1 } }] }],
    });
    runner.update(0.5);
    expect(shellMaterial.opacity).toBeCloseTo(0.5);
    expect(shellMaterial.transparent).toBe(true);
    // The untargeted contents are untouched.
    expect(contentsMaterial.opacity).toBe(0.8);
    runner.update(0.5);
    expect(runner.active).toBe(0);
  });

  it("can fade only a contained block's contents, from their own opacity", () => {
    const { v, shellMaterial, contentsMaterial } = visual();
    const runner = createExitRunner();
    runner.start(snapshot, v, {
      steps: [{ effects: [{ effect: "fade", target: "contents", config: { seconds: 1 } }] }],
    });
    runner.update(0.25);
    expect(contentsMaterial.opacity).toBeCloseTo(0.6);
    expect(shellMaterial.opacity).toBe(1);
    runner.dispose();
  });

  it("works in place: every material keeps its hooks, program key and live uniforms (#490 review)", () => {
    const { v, shell, shellMaterial } = visual();
    const hook = vi.fn();
    shellMaterial.onBeforeCompile = hook;
    const shaded = new THREE.ShaderMaterial({ uniforms: { time: { value: 1 } } });
    const extra = new THREE.Mesh(new THREE.BoxGeometry(), shaded);
    v.root.add(extra);
    const runner = createExitRunner();
    runner.start(snapshot, v, {
      steps: [{ effects: [{ effect: "fade", config: { seconds: 1 } }] }],
    });
    runner.update(0.5);
    expect(shell.material).toBe(shellMaterial);
    // oxlint-disable-next-line typescript/unbound-method -- comparing hook identity only
    expect(shellMaterial.onBeforeCompile).toBe(hook);
    expect(extra.material).toBe(shaded);
    expect(shaded.opacity).toBeCloseTo(0.5);
    runner.dispose();
  });

  it("restores each material's opacity, transparency and depth writing before the release", () => {
    const { v, shellMaterial, released } = visual();
    let restoredFirst = false;
    released.mockImplementation(() => {
      restoredFirst =
        shellMaterial.opacity === 1 && !shellMaterial.transparent && shellMaterial.depthWrite;
    });
    const runner = createExitRunner();
    runner.start(snapshot, v, {
      steps: [{ effects: [{ effect: "fade", config: { seconds: 0.2 } }] }],
    });
    runner.update(0.3);
    expect(released).toHaveBeenCalledTimes(1);
    expect(restoredFirst).toBe(true);
  });

  it("ends at once under reduced motion, and restores on cancellation", () => {
    const reduced = visual();
    const runner = createExitRunner(() => true);
    runner.start(snapshot, reduced.v, { steps: [{ effects: [{ effect: "fade" }] }] });
    expect(reduced.shellMaterial.opacity).toBe(0);
    runner.update(0.016);
    expect(runner.active).toBe(0);
    const cancelled = visual();
    const other = createExitRunner();
    other.start(snapshot, cancelled.v, { steps: [{ effects: [{ effect: "fade" }] }] });
    other.cancel("b1");
    expect(cancelled.shellMaterial.opacity).toBe(1);
    expect(cancelled.released).toHaveBeenCalledTimes(1);
  });
});
