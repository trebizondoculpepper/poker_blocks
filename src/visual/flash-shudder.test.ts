import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { createExitRunner, type ExitVisual } from "./exit-presentation";
import { createFlash, createShudder } from "./flash-shudder";

const lit = () => new THREE.MeshStandardMaterial({ emissive: 0x112233, emissiveIntensity: 0.2 });

describe("flash (#441)", () => {
  it("glows toward its colour and back, then restores every emissive exactly", () => {
    const material = lit();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    const flash = createFlash([mesh], { colour: 0xffffff, intensity: 2, seconds: 1 });
    flash.update(0.5);
    expect(material.emissiveIntensity).toBeCloseTo(2);
    expect(material.emissive.getHex()).toBe(0xffffff);
    while (flash.update(0.1));
    expect(material.emissive.getHex()).toBe(0x112233);
    expect(material.emissiveIntensity).toBeCloseTo(0.2);
  });

  it("restores when stopped part-way, and leaves materials that can't glow alone", () => {
    const material = lit();
    const plain = new THREE.MeshBasicMaterial({ color: 0x445566 });
    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(new THREE.BoxGeometry(), material),
      new THREE.Mesh(new THREE.BoxGeometry(), plain),
    );
    const flash = createFlash([group], { seconds: 1 });
    flash.update(0.3);
    flash.dispose();
    expect(material.emissive.getHex()).toBe(0x112233);
    expect(plain.color.getHex()).toBe(0x445566);
  });

  it("doesn't pulse under reduced motion", () => {
    const material = lit();
    const flash = createFlash([new THREE.Mesh(new THREE.BoxGeometry(), material)], {}, true);
    expect(flash.update(0.016)).toBe(false);
    expect(material.emissiveIntensity).toBeCloseTo(0.2);
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
    runner.update(0.1);
    expect(material.emissiveIntensity).not.toBeCloseTo(0.2);
    for (let frame = 0; frame < 10; frame++) runner.update(0.05);
    expect(runner.active).toBe(0);
    expect(material.emissiveIntensity).toBeCloseTo(0.2);
    expect(root.position.toArray()).toEqual([0, 0, 0]);
  });
});
