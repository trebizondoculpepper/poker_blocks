import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { createExitRunner, exitEffects, type ExitVisual } from "./exit-presentation";
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

describe("fade beside another effect's output (#490 review)", () => {
  it("fades only the block's own materials, never what a sibling effect adds, in either order", () => {
    // A stand-in sibling effect that adds an opaque mesh of its own, as a flash or burst does.
    exitEffects.register("testSibling", ({ visual }) => {
      const added = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
      visual.root.add(added);
      return { update: () => false, finish() {}, dispose: () => void added.removeFromParent() };
    });
    for (const order of [
      [{ effect: "testSibling" }, { effect: "fade" }],
      [{ effect: "fade" }, { effect: "testSibling" }],
    ]) {
      const { v, shellMaterial } = visual();
      const before = v.root.children.length;
      const runner = createExitRunner();
      runner.start(snapshot, v, { steps: [{ effects: order }] });
      const added = v.root.children.slice(before) as THREE.Mesh[];
      expect(added).toHaveLength(1);
      runner.update(0.2);
      expect(shellMaterial.opacity).toBeLessThan(1);
      const sibling = added[0]!.material as THREE.Material;
      expect(sibling.opacity).toBe(1);
      expect(sibling.transparent).toBe(false);
      runner.dispose();
    }
  });
});

describe("overlapping fades (#490 review)", () => {
  it("compose: a shorter fade finishing never lets the target reappear, and settings restore once", () => {
    const { v, shellMaterial } = visual();
    shellMaterial.depthWrite = true;
    const runner = createExitRunner();
    runner.start(snapshot, v, {
      steps: [
        {
          effects: [
            { effect: "fade", config: { seconds: 0.2 } },
            { effect: "fade", target: "shell", config: { seconds: 1 } },
          ],
        },
      ],
    });
    runner.update(0.1);
    const halfway = shellMaterial.opacity;
    runner.update(0.2);
    expect(shellMaterial.opacity).toBe(0);
    runner.update(0.3);
    expect(shellMaterial.opacity).toBe(0);
    expect(halfway).toBeLessThan(0.5);
    runner.dispose();
    expect(shellMaterial.opacity).toBe(1);
    expect(shellMaterial.depthWrite).toBe(true);
    expect(shellMaterial.transparent).toBe(false);
  });
});

describe("fade edge cases (#490 review)", () => {
  it("scales a cut-out threshold with the fade and restores it", () => {
    const { v, shellMaterial } = visual();
    shellMaterial.alphaTest = 0.5;
    const runner = createExitRunner();
    runner.start(snapshot, v, {
      steps: [{ effects: [{ effect: "fade", target: "shell", config: { seconds: 1 } }] }],
    });
    runner.update(0.5);
    expect(shellMaterial.alphaTest).toBeCloseTo(0.25);
    expect(shellMaterial.opacity).toBeCloseTo(0.5);
    runner.dispose();
    expect(shellMaterial.alphaTest).toBe(0.5);
  });

  it("a shell-only fade leaves contents nested inside the shell alone", () => {
    const { v, shell, contents, contentsMaterial } = visual();
    shell.add(contents);
    const runner = createExitRunner();
    runner.start(snapshot, v, {
      steps: [{ effects: [{ effect: "fade", target: "shell", config: { seconds: 1 } }] }],
    });
    runner.update(0.5);
    expect(contentsMaterial.opacity).toBe(0.8);
    runner.dispose();
  });

  it("a whole fade covers contents even when the root is also the shell", () => {
    const { contents, contentsMaterial } = visual();
    const root = new THREE.Group();
    root.add(contents);
    new THREE.Group().add(root);
    const v: ExitVisual = { root, shell: [root], contents: [contents], release() {} };
    const runner = createExitRunner();
    runner.start(snapshot, v, {
      steps: [{ effects: [{ effect: "fade", config: { seconds: 1 } }] }],
    });
    runner.update(0.5);
    expect(contentsMaterial.opacity).toBeCloseTo(0.4);
    runner.dispose();
  });
});
