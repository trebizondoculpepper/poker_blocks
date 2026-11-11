import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { createExitRunner, type ExitVisual } from "./exit-presentation";
import { createFlash, createShudder } from "./flash-shudder";

const lit = () => new THREE.MeshStandardMaterial({ emissive: 0x112233, emissiveIntensity: 0.2 });

const overlay = (mesh: THREE.Mesh) => mesh.children[0] as THREE.Mesh | undefined;

describe("flash (#441)", () => {
  it("pulses an additive overlay of the mesh up and back, never touching its material", () => {
    const material = lit();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    const flash = createFlash([mesh], { colour: 0xff0000, intensity: 1, seconds: 1 });
    const glow = overlay(mesh)!;
    expect(glow.geometry).toBe(mesh.geometry);
    flash.update(0.5);
    const shown = glow.material as THREE.MeshBasicMaterial;
    expect(shown.opacity).toBeCloseTo(1);
    expect(shown.color.getHex()).toBe(0xff0000);
    while (flash.update(0.1));
    expect(shown.opacity).toBeCloseTo(0);
    expect(mesh.material).toBe(material);
    expect(material.emissive.getHex()).toBe(0x112233);
  });

  it("removes its overlays and frees its one material when disposed, whatever the meshes wear", () => {
    const shaded = new THREE.ShaderMaterial();
    const group = new THREE.Group();
    const [a, b] = [
      new THREE.Mesh(new THREE.BoxGeometry(), lit()),
      new THREE.Mesh(new THREE.BoxGeometry(), shaded),
    ];
    group.add(a, b);
    const flash = createFlash([group], { seconds: 1 });
    const glow = overlay(a)!.material as THREE.Material;
    expect(overlay(b)!.material).toBe(glow);
    const freed = vi.spyOn(glow, "dispose");
    flash.update(0.3);
    flash.dispose();
    flash.dispose();
    expect(a.children).toEqual([]);
    expect(b.children).toEqual([]);
    expect(freed).toHaveBeenCalledTimes(1);
  });

  it("adds nothing and doesn't pulse under reduced motion", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), lit());
    const flash = createFlash([mesh], {}, true);
    expect(mesh.children).toEqual([]);
    expect(flash.update(0.016)).toBe(false);
    flash.dispose();
  });
});

describe("shudder (#441)", () => {
  it("shakes about its own position, decays, and puts it back exactly", () => {
    const target = new THREE.Group();
    target.position.set(1, 2, 3);
    const shudder = createShudder(target, { amplitude: 0.1, seconds: 0.5 });
    shudder.update(0.01);
    expect(target.position.distanceTo(new THREE.Vector3(1, 2, 3))).toBeGreaterThan(0);
    expect(target.position.distanceTo(new THREE.Vector3(1, 2, 3))).toBeLessThanOrEqual(
      0.1 * Math.sqrt(3),
    );
    while (shudder.update(0.05));
    expect(target.position.toArray()).toEqual([1, 2, 3]);
  });

  it("restores when stopped part-way, and doesn't move under reduced motion", () => {
    const target = new THREE.Group();
    target.position.set(4, 0, 0);
    const shudder = createShudder(target, { seconds: 1 });
    shudder.update(0.1);
    shudder.dispose();
    expect(target.position.toArray()).toEqual([4, 0, 0]);
    const still = createShudder(target, {}, true);
    expect(still.update(0.016)).toBe(false);
    expect(target.position.toArray()).toEqual([4, 0, 0]);
  });
});

describe("flash and shudder as exit effects (#441)", () => {
  it("run in an exit together and leave the visual as they found it", () => {
    const material = lit();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    new THREE.Group().add(root);
    const visual: ExitVisual = { root, shell: [root], contents: [], release: vi.fn() };
    const runner = createExitRunner();
    runner.start({ blockId: "b" }, visual, {
      steps: [
        {
          effects: [
            { effect: "flash", config: { seconds: 0.2 } },
            { effect: "shudder", config: { seconds: 0.3 } },
          ],
        },
      ],
    });
    const mesh = root.children[0] as THREE.Mesh;
    runner.update(0.1);
    expect(mesh.children).toHaveLength(1);
    for (let frame = 0; frame < 10; frame++) runner.update(0.05);
    expect(runner.active).toBe(0);
    expect(mesh.children).toEqual([]);
    expect(material.emissiveIntensity).toBeCloseTo(0.2);
    expect(root.position.toArray()).toEqual([0, 0, 0]);
  });
});

describe("overlapping flashes and shudders (#511 review)", () => {
  it("a second flash never overlays the first's overlay, and each keeps its own until it ends", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), lit());
    const first = createFlash([mesh], { seconds: 1 });
    const second = createFlash([mesh], { seconds: 1 });
    expect(mesh.children).toHaveLength(2);
    const [mine, theirs] = mesh.children as THREE.Mesh[];
    expect(mine!.children).toEqual([]);
    expect(theirs!.children).toEqual([]);
    first.dispose();
    expect(mesh.children).toHaveLength(1);
    second.dispose();
    expect(mesh.children).toEqual([]);
  });

  it("overlapping shudders compose about one home, which is restored when the last ends", () => {
    const target = new THREE.Group();
    target.position.set(1, 0, 0);
    const first = createShudder(target, { seconds: 0.4 });
    first.update(0.05);
    const second = createShudder(target, { seconds: 1 });
    first.update(1);
    second.update(0.05);
    expect(target.position.toArray()).not.toEqual([1, 0, 0]);
    while (second.update(0.05));
    expect(target.position.toArray()).toEqual([1, 0, 0]);
    // Cancelled part-way, in either order, it still comes home.
    const a = createShudder(target, { seconds: 1 });
    const b = createShudder(target, { seconds: 1 });
    a.update(0.1);
    b.update(0.1);
    a.dispose();
    b.dispose();
    expect(target.position.toArray()).toEqual([1, 0, 0]);
  });

  it("are loaded wherever exits are run from the effects module", async () => {
    const { exitEffects } = await import("./exit-effects");
    for (const name of ["flash", "shudder", "shred", "splinter", "burst"])
      expect(exitEffects.has(name)).toBe(true);
  });
});
