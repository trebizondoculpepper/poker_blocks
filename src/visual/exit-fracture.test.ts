import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { createExitRunner, type ExitVisual } from "./exit-presentation";
import { pieceSources } from "./exit-fracture";

function visual() {
  const root = new THREE.Group();
  const faces = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  const fan = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.1), new THREE.MeshBasicMaterial());
  fan.position.set(0, 0, 0.9);
  root.add(faces, fan);
  new THREE.Group().add(root);
  const v: ExitVisual = { root, shell: [faces, fan], contents: [], release: vi.fn() };
  return { v, root, faces, fan };
}
const run = (v: ExitVisual, effect: string, config: object, reduced = false) => {
  const runner = createExitRunner(() => reduced);
  runner.start({ blockId: "b" }, v, {
    steps: [{ effects: [{ effect, target: "shell", config }] }],
  });
  return runner;
};

describe("crack (#442)", () => {
  it("grows crack lines over the block without touching it, then removes and frees them", () => {
    const { v, root, faces } = visual();
    const runner = run(v, "crack", { seconds: 1 });
    const lines = root.children.find(
      (child): child is THREE.LineSegments => child instanceof THREE.LineSegments,
    )!;
    expect(lines.geometry.drawRange.count).toBe(0);
    runner.update(0.5);
    const half = lines.geometry.drawRange.count;
    expect(half).toBeGreaterThan(0);
    const freed = vi.spyOn(lines.geometry, "dispose");
    runner.update(0.6);
    expect(faces.visible).toBe(true);
    expect(lines.parent).toBeNull();
    expect(freed).toHaveBeenCalledTimes(1);
  });
});

describe("fracture (#442)", () => {
  it("throws the block's own components apart, then puts them back for the release", () => {
    const { v, fan } = visual();
    const runner = run(v, "fracture", { pieces: "components", life: 0.5 });
    runner.update(0.2);
    expect(fan.position.distanceTo(new THREE.Vector3(0, 0, 0.9))).toBeGreaterThan(0);
    runner.update(0.5);
    expect(fan.position.toArray()).toEqual([0, 0, 0.9]);
    expect(fan.quaternion.toArray()).toEqual([0, 0, 0, 1]);
  });

  it("breaks into a registered piece set, hides the block meanwhile, and cleans up after", () => {
    const { v, root, faces } = visual();
    const before = root.children.length;
    const runner = run(v, "fracture", { pieces: "slabs", life: 0.5 });
    expect(root.children.length).toBe(before + 5);
    expect(faces.visible).toBe(false);
    const piece = root.children.at(-1) as THREE.Mesh;
    const freed = vi.spyOn(piece.material as THREE.Material, "dispose");
    const shared = vi.spyOn(piece.geometry, "dispose");
    runner.update(0.6);
    expect(root.children.length).toBe(before);
    expect(faces.visible).toBe(true);
    expect(freed).toHaveBeenCalledTimes(1);
    expect(shared).not.toHaveBeenCalled();
  });

  it("shares a set's geometry between fractures", () => {
    const a = visual();
    const b = visual();
    run(a.v, "fracture", { pieces: "shards" });
    run(b.v, "fracture", { pieces: "shards" });
    const geometry = (root: THREE.Object3D) => (root.children.at(-1) as THREE.Mesh).geometry;
    expect(geometry(a.root)).toBe(geometry(b.root));
  });

  it("does nothing under reduced motion, and refuses an unknown piece source", () => {
    const { v, root, faces } = visual();
    const before = root.children.length;
    const runner = run(v, "fracture", { pieces: "slabs" }, true);
    expect(root.children.length).toBe(before);
    expect(faces.visible).toBe(true);
    runner.update(0.016);
    expect(runner.active).toBe(0);
    expect(() => pieceSources.get("no-such-set")).toThrow();
  });
});

describe("targets and grouped components (#512 review)", () => {
  it("cracks only its configured target: a solid block's empty contents get no cracks", () => {
    const { v, root } = visual();
    const runner = createExitRunner();
    runner.start({ blockId: "b" }, v, {
      steps: [{ effects: [{ effect: "crack", target: "contents" }] }],
    });
    const lines = root.children.find(
      (child): child is THREE.LineSegments => child instanceof THREE.LineSegments,
    )!;
    expect(lines.geometry.attributes.position?.count ?? 0).toBe(0);
    runner.update(0.016);
    expect(runner.active).toBe(0);
  });

  it("keeps a group wrapping flying components visible, so its pieces can be seen", () => {
    const root = new THREE.Group();
    const wrapper = new THREE.Group();
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.1, 0.1),
      new THREE.MeshBasicMaterial(),
    );
    wrapper.add(blade);
    root.add(wrapper);
    new THREE.Group().add(root);
    const v: ExitVisual = { root, shell: [wrapper], contents: [], release: vi.fn() };
    const runner = createExitRunner();
    runner.start({ blockId: "b" }, v, {
      steps: [
        { effects: [{ effect: "fracture", target: "shell", config: { pieces: "components" } }] },
      ],
    });
    expect(wrapper.visible).toBe(true);
    expect(blade.visible).toBe(true);
    runner.dispose();
  });

  it("sizes and places a piece set from its target, in the block's own space (#512 review)", () => {
    const { v, root } = visual();
    root.parent!.rotation.y = Math.PI / 4;
    root.parent!.updateMatrixWorld(true);
    const before = root.children.length;
    const runner = createExitRunner();
    runner.start({ blockId: "b" }, v, {
      steps: [{ effects: [{ effect: "fracture", target: "shell", config: { pieces: "slabs" } }] }],
    });
    const piece = root.children[before] as THREE.Mesh;
    // The shell is the 2-unit body (and the fan inside it): unchanged by the turn.
    expect(piece.scale.x).toBeCloseTo(2);
    runner.dispose();
    const empty = createExitRunner();
    empty.start({ blockId: "c" }, v, {
      steps: [
        { effects: [{ effect: "fracture", target: "contents", config: { pieces: "slabs" } }] },
      ],
    });
    expect(root.children.length).toBe(before);
    empty.dispose();
  });
});

describe("fracture beside other effects (#512 review)", () => {
  it("never hides a sibling effect's particles: a burst alongside stays visible", async () => {
    await import("./exit-burst");
    const { v, root } = visual();
    const runner = createExitRunner();
    runner.start({ blockId: "b" }, v, {
      steps: [
        { effects: [{ effect: "burst" }, { effect: "fracture", config: { pieces: "slabs" } }] },
      ],
    });
    const particles = root.children.find((child) => child instanceof THREE.Points)!;
    expect(particles.visible).toBe(true);
    runner.dispose();
  });
});
