import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { type ExitVisual } from "./exit-presentation";
import { createSteppedExits } from "./exit-stepping";
import { confettiDefaults, maxFragments, shredDefaults, splinterDefaults } from "./exit-fragments";

function visual(): ExitVisual {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  root.add(body);
  new THREE.Group().add(root);
  return { root, shell: [body], contents: [], release: vi.fn() };
}
const fragments = (v: ExitVisual) => v.root.children.slice(1) as THREE.Mesh[];
const start = (v: ExitVisual, effect: string, config: object = {}, reduced = false) => {
  const runner = createSteppedExits(() => reduced);
  runner.start({ blockId: "b" }, v, { steps: [{ effects: [{ effect, config }] }] });
  return runner;
};

describe("shred and splinter (#443)", () => {
  it("are separate effects, differing only in their default data", () => {
    const [shred, splinter] = [visual(), visual()];
    start(shred, "shred").dispose();
    const a = start(shred, "shred");
    const b = start(splinter, "splinter");
    expect(fragments(shred)).toHaveLength(shredDefaults.count);
    expect(fragments(splinter)).toHaveLength(splinterDefaults.count);
    expect(fragments(shred)[0]!.geometry).not.toBe(fragments(splinter)[0]!.geometry);
    expect(shredDefaults.drag).toBeGreaterThan(splinterDefaults.drag);
    a.dispose();
    b.dispose();
  });

  it("paper flutters: with its drag, scraps fall far slower than splinters", () => {
    const fall = (effect: string) => {
      const v = visual();
      const runner = start(v, effect, { lift: 0, speed: [0, 0], life: 2 });
      for (let frame = 0; frame < 30; frame++) runner.update(1 / 60);
      const drop =
        -fragments(v).reduce((sum, mesh) => sum + mesh.position.y, 0) / fragments(v).length;
      runner.dispose();
      return drop;
    };
    expect(fall("shred")).toBeLessThan(fall("splinter"));
  });

  it("takes any setting by configuration, within its bound", () => {
    const v = visual();
    const runner = start(v, "splinter", { count: 9999, colour: 0x123456 });
    expect(fragments(v)).toHaveLength(maxFragments);
    expect((fragments(v)[0]!.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x123456);
    runner.dispose();
  });

  it("shares shapes, frees its material and removes its fragments when it ends", () => {
    const [x, y] = [visual(), visual()];
    const rx = start(x, "splinter", { life: 0.2 });
    const ry = start(y, "splinter");
    expect(fragments(x)[0]!.geometry).toBe(fragments(y)[0]!.geometry);
    const material = fragments(x)[0]!.material as THREE.Material;
    const freed = vi.spyOn(material, "dispose");
    const shared = vi.spyOn(fragments(x)[0]!.geometry, "dispose");
    rx.update(0.3);
    expect(fragments(x)).toEqual([]);
    expect(freed).toHaveBeenCalledTimes(1);
    expect(shared).not.toHaveBeenCalled();
    ry.dispose();
  });

  it("shows nothing under reduced motion", () => {
    const v = visual();
    const runner = start(v, "shred", {}, true);
    expect(fragments(v)).toEqual([]);
    runner.update(0.016);
    expect(runner.active).toBe(0);
  });

  it("emits only from its configured target: a solid block's empty contents throw nothing (#513 review)", () => {
    const v = visual();
    const runner = createSteppedExits();
    runner.start({ blockId: "b" }, v, {
      steps: [{ effects: [{ effect: "shred", target: "contents" }] }],
    });
    expect(fragments(v)).toEqual([]);
    runner.update(0.016);
    expect(runner.active).toBe(0);
    const shell = visual();
    const other = createSteppedExits();
    other.start({ blockId: "c" }, shell, {
      steps: [{ effects: [{ effect: "shred", target: "shell" }] }],
    });
    expect(fragments(shell)).toHaveLength(shredDefaults.count);
    other.dispose();
  });

  it("confetti (#494): small paper squares split across its colours, bounded, then gone", () => {
    const v = visual();
    const runner = start(v, "confetti", { count: 10, colours: [0xff0000, 0x00ff00, 0x0000ff] });
    const pieces = fragments(v);
    expect(pieces).toHaveLength(10);
    const colours = pieces.map((mesh) =>
      (mesh.material as THREE.MeshStandardMaterial).color.getHex(),
    );
    expect(colours.filter((c) => c === 0xff0000)).toHaveLength(4);
    expect(colours.filter((c) => c === 0x00ff00)).toHaveLength(3);
    expect(colours.filter((c) => c === 0x0000ff)).toHaveLength(3);
    for (let frame = 0; frame < 200; frame++) runner.update(1 / 60);
    expect(fragments(v)).toHaveLength(0);
    const many = visual();
    start(many, "confetti", { count: 9999 }).dispose();
    const bounded = start(many, "confetti", { count: 9999 });
    expect(fragments(many)).toHaveLength(maxFragments);
    bounded.dispose();
    expect(confettiDefaults.colours.length).toBeGreaterThan(1);
    const still = visual();
    start(still, "confetti", {}, true);
    expect(fragments(still)).toHaveLength(0);
  });
});
