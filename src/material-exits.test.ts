import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { experimentalMaterials, materialDefinitions, type MaterialDefinition } from "./materials";
import { createExitRunner, exitEffects, exitTargets, type ExitVisual } from "./visual/exit-effects";

const all: readonly MaterialDefinition[] = [...materialDefinitions, ...experimentalMaterials];
const exitOf = (id: string) => all.find((material) => material.id === id)!.appearance.exit!;

const release = vi.fn();

/** A container block: a shell mesh holding a contents mesh, each with its own material. */
function container(): ExitVisual & { shellMesh: THREE.Mesh; contentsMesh: THREE.Mesh } {
  const root = new THREE.Group();
  const shellMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial(),
  );
  const contentsMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.8),
    new THREE.MeshStandardMaterial(),
  );
  root.add(shellMesh, contentsMesh);
  new THREE.Group().add(root);
  return { root, shell: [shellMesh], contents: [contentsMesh], release, shellMesh, contentsMesh };
}
function visual(): ExitVisual {
  const root = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ transparent: false, opacity: 1 }),
  );
  root.add(body);
  new THREE.Group().add(root);
  return { root, shell: [body], contents: [], release };
}

describe("material exits (#438)", () => {
  it("every material's exit names only registered effects and targets", () => {
    for (const { appearance } of all)
      for (const step of appearance.exit?.steps ?? [])
        for (const { effect, target = "whole" } of step.effects) {
          expect(exitEffects.has(effect), effect).toBe(true);
          expect(exitTargets.has(target), target).toBe(true);
        }
  });

  it("wood splinters into tumbling fragments as the block vanishes, then cleans up (#448)", () => {
    release.mockClear();
    const v = visual();
    const body = v.root.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const runner = createExitRunner(() => false);
    runner.start({ blockId: "w" }, v, exitOf("wood"));
    const splinters = v.root.children.slice(1);
    expect(splinters).toHaveLength(14);
    for (let frame = 0; frame < 6; frame++) runner.update(1 / 60);
    expect(body.material.opacity).toBeLessThan(0.5);
    for (let frame = 0; frame < 180; frame++) runner.update(1 / 60);
    expect(runner.active).toBe(0);
    expect(v.root.parent).toBeNull();
    expect(release).toHaveBeenCalledOnce();
  });

  it("wood's exit shows no debris and ends at once with reduced motion", () => {
    const v = visual();
    const runner = createExitRunner(() => true);
    runner.start({ blockId: "w" }, v, exitOf("wood"));
    expect(v.root.children).toHaveLength(1);
    runner.update(1 / 60);
    expect(runner.active).toBe(0);
  });

  it("terracotta fractures into pottery shards that scatter and fade (#455)", () => {
    release.mockClear();
    const v = visual();
    const runner = createExitRunner(() => false);
    runner.start({ blockId: "t" }, v, exitOf("terracotta"));
    const shards = v.root.children.slice(1) as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >[];
    expect(shards).toHaveLength(8);
    runner.update(0.3);
    expect(shards[0]!.material.opacity).toBe(1);
    runner.update(0.4);
    expect(shards[0]!.material.opacity).toBeGreaterThan(0);
    expect(shards[0]!.material.opacity).toBeLessThan(0.6);
    runner.update(0.3);
    expect(runner.active).toBe(0);
    expect(release).toHaveBeenCalledOnce();
  });

  it("paper bursts into torn scraps that flutter and fade as the sheet vanishes (#447)", () => {
    release.mockClear();
    const v = visual();
    const body = v.root.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const runner = createExitRunner(() => false);
    runner.start({ blockId: "p" }, v, exitOf("paper"));
    expect(v.root.children.slice(1)).toHaveLength(28);
    for (let frame = 0; frame < 6; frame++) runner.update(1 / 60);
    expect(body.material.opacity).toBeLessThan(0.5);
    for (let frame = 0; frame < 240; frame++) runner.update(1 / 60);
    expect(runner.active).toBe(0);
    expect(release).toHaveBeenCalledOnce();
  });

  it("ice cracks into five translucent predefined pieces that scatter and fade (#449)", () => {
    release.mockClear();
    const v = visual();
    const runner = createExitRunner(() => false);
    runner.start({ blockId: "i" }, v, exitOf("ice"));
    const pieces = v.root.children.slice(1) as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >[];
    expect(pieces).toHaveLength(5);
    expect(pieces[0]!.material.transparent).toBe(true);
    expect(pieces[0]!.material.opacity).toBeCloseTo(0.55);
    // Shared, predefined geometry: another ice block's pieces reuse it.
    const other = visual();
    const second = createExitRunner(() => false);
    second.start({ blockId: "i2" }, other, exitOf("ice"));
    expect((other.root.children[1] as THREE.Mesh).geometry).toBe(pieces[0]!.geometry);
    runner.update(0.75);
    expect(pieces[0]!.material.opacity).toBeLessThan(0.55);
    runner.update(0.3);
    expect(runner.active).toBe(0);
    second.dispose();
  });

  it("meat breaks into a few soft chunks that tumble and fade (#450)", () => {
    release.mockClear();
    const v = visual();
    const runner = createExitRunner(() => false);
    runner.start({ blockId: "m" }, v, exitOf("meat"));
    const chunks = v.root.children.slice(1) as THREE.Mesh<
      THREE.SphereGeometry,
      THREE.MeshStandardMaterial
    >[];
    expect(chunks).toHaveLength(5);
    // Soft, rounded lumps: spheres, not sharp shards.
    expect(chunks.every(({ geometry }) => geometry.type === "SphereGeometry")).toBe(true);
    runner.update(0.75);
    expect(chunks[0]!.material.opacity).toBeLessThan(1);
    runner.update(0.2);
    expect(runner.active).toBe(0);
    expect(release).toHaveBeenCalledOnce();
  });

  it("magic: the shell breaks apart and releases its stars outward, then they fade (#458)", () => {
    release.mockClear();
    const v = container();
    const runner = createExitRunner(() => false);
    runner.start({ blockId: "magic" }, v, exitOf("magic"));
    expect(v.root.children.some((child) => child instanceof THREE.Points)).toBe(true);
    for (let frame = 0; frame < 90; frame++) runner.update(1 / 60);
    expect(runner.active).toBe(0);
    expect(release).toHaveBeenCalledOnce();
  });

  it("crystal cracks, then flashes and bursts into dissipating stars (#451)", () => {
    release.mockClear();
    const v = visual();
    const body = v.root.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const runner = createExitRunner(() => false);
    runner.start({ blockId: "c" }, v, exitOf("prismatic"));
    const own = body.material;
    // First the crack lines, the block still whole.
    expect(v.root.children.length).toBeGreaterThan(1);
    expect(v.root.children.some((child) => child instanceof THREE.Points)).toBe(false);
    runner.update(0.3);
    // Then the flash and the star burst, the block gone at once.
    expect(v.root.children.some((child) => child instanceof THREE.Points)).toBe(true);
    // Hidden at once, whatever its shader: its own material is swapped for an invisible one.
    expect(body.material.visible).toBe(false);
    for (let frame = 0; frame < 120; frame++) runner.update(1 / 60);
    expect(runner.active).toBe(0);
    expect(release).toHaveBeenCalledOnce();
    // Its own material is back for the owner's release.
    expect(body.material).toBe(own);
  });
});
