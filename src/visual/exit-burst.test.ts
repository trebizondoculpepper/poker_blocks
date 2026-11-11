import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { createExitRunner, type ExitVisual } from "./exit-presentation";
import { maxParticles } from "./exit-burst";

function visual(): ExitVisual {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial()));
  new THREE.Group().add(root);
  return { root, shell: [], contents: [], release: vi.fn() };
}
const points = (v: ExitVisual) =>
  v.root.children.find((child): child is THREE.Points => child instanceof THREE.Points);
const heights = (p: THREE.Points) =>
  Array.from({ length: p.geometry.attributes.position!.count }, (_, i) =>
    p.geometry.attributes.position!.getY(i),
  );

describe("particle burst exit effect (#444)", () => {
  it("launches its configured count outward, then gravity brings them down: a parabola", () => {
    const v = visual();
    const runner = createExitRunner();
    runner.start({ blockId: "b" }, v, {
      steps: [
        {
          effects: [
            {
              effect: "burst",
              config: { count: 30, speed: [0.5, 0.5], lift: 3, gravity: 4, life: 2 },
            },
          ],
        },
      ],
    });
    const burst = points(v)!;
    expect(burst.geometry.attributes.position!.count).toBe(30);
    for (let frame = 0; frame < 6; frame++) runner.update(1 / 60);
    const early = heights(burst).reduce((a, b) => a + b, 0) / 30;
    for (let frame = 0; frame < 90; frame++) runner.update(1 / 60);
    const late = heights(burst).reduce((a, b) => a + b, 0) / 30;
    // Launched upward on average (the lift), then pulled below where they started.
    expect(early).toBeGreaterThan(0);
    expect(late).toBeLessThan(early);
    expect((burst.material as THREE.PointsMaterial).opacity).toBeLessThan(1);
    runner.dispose();
  });

  it("never emits more than its bound", () => {
    const v = visual();
    const runner = createExitRunner();
    runner.start({ blockId: "b" }, v, {
      steps: [{ effects: [{ effect: "burst", config: { count: 99999 } }] }],
    });
    expect(points(v)!.geometry.attributes.position!.count).toBe(maxParticles);
    runner.dispose();
  });

  it("frees what it made when it ends, and removes its particles", () => {
    const v = visual();
    const runner = createExitRunner();
    runner.start({ blockId: "b" }, v, {
      steps: [{ effects: [{ effect: "burst", config: { life: 0.2 } }] }],
    });
    const burst = points(v)!;
    const geometry = vi.spyOn(burst.geometry, "dispose");
    const material = vi.spyOn(burst.material as THREE.Material, "dispose");
    runner.update(0.3);
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
    expect(burst.parent).toBeNull();
    expect(runner.active).toBe(0);
  });

  it("shows nothing and ends at once under reduced motion", () => {
    const v = visual();
    const runner = createExitRunner(() => true);
    runner.start({ blockId: "b" }, v, { steps: [{ effects: [{ effect: "burst" }] }] });
    expect(points(v)!.geometry.attributes.position!.count).toBe(0);
    runner.update(0.016);
    expect(runner.active).toBe(0);
  });
});
