import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import type { BlockAppearance } from "./block-appearance";
import { ghostStyles, laserWidthScaleRange } from "./ghost-styles";

/** An appearance with faces, one extra and a prepass, every shared resource spied on. */
function appearance(): BlockAppearance & { faces: THREE.MeshStandardMaterial[] } {
  const faces = Array.from({ length: 6 }, () => new THREE.MeshStandardMaterial());
  const extra = new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshBasicMaterial());
  extra.position.set(0.1, 0, 0);
  return {
    faces,
    geometry: new THREE.BoxGeometry(1, 1, 1),
    textures: [],
    materials: faces,
    edgeColor: 0x123456,
    edgeOpacity: 0.5,
    extras: [extra],
    prepasses: [{ handler: "test-pass" }],
  };
}

const meshesIn = (object: THREE.Object3D) => {
  const found: THREE.Mesh[] = [];
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) found.push(child as THREE.Mesh);
  });
  return found;
};

describe("drag-ghost appearance styles (#1083; doc/drag-ghost-audition.md)", () => {
  it("registers the three required styles by handler name", () => {
    for (const name of ["wireframe", "faceFree", "laserCube"])
      expect(ghostStyles.has(name)).toBe(true);
  });

  it("wireframe draws the carried geometry's edges and no filled faces", () => {
    const look = appearance();
    const endpoint = ghostStyles.get("wireframe").create({ appearance: look, size: 1 }, {});
    expect(endpoint.object).toBeInstanceOf(THREE.LineSegments);
    expect(meshesIn(endpoint.object)).toHaveLength(0);
    // A box has 12 edges: the silhouette is the model's, not a screen-space square.
    const edges = (endpoint.object as THREE.LineSegments).geometry.getAttribute("position");
    expect(edges.count).toBe(24);
  });

  it("face-free keeps the declared extras and outline, never the face materials", () => {
    const look = appearance();
    const endpoint = ghostStyles.get("faceFree").create({ appearance: look, size: 1 }, {});
    const materials = meshesIn(endpoint.object).flatMap(({ material }) => [material].flat());
    for (const face of look.faces) expect(materials).not.toContain(face);
    // The extra is shared by reference, at its own local transform.
    const [extra] = meshesIn(endpoint.object);
    expect(extra.geometry).toBe(look.extras![0].geometry);
    expect(extra.position.x).toBeCloseTo(0.1);
    expect(endpoint.prepasses).toEqual(look.prepasses);
  });

  it("laser cube reuses the laser outline with thicker beams, clamped", () => {
    const radii = (config: object) => {
      const endpoint = ghostStyles
        .get("laserCube")
        .create({ appearance: appearance(), size: 1 }, { colour: 0x65f4dd, ...config });
      const [glow, core] = meshesIn(endpoint.object);
      core.geometry.computeBoundingBox();
      glow.geometry.computeBoundingBox();
      endpoint.update(1);
      endpoint.dispose();
      return {
        core: core.geometry.boundingBox!.max.x,
        glow: glow.geometry.boundingBox!.max.x,
      };
    };
    const plain = radii({ widthScale: 1 });
    const thicker = radii({});
    const half = 0.5;
    // Beam radius past the cube's half-width scales by the default 1.25.
    expect(thicker.glow - half).toBeCloseTo((plain.glow - half) * 1.25, 4);
    const huge = radii({ widthScale: 100 });
    expect(huge.glow - half).toBeCloseTo((plain.glow - half) * laserWidthScaleRange.max, 4);
  });

  it("disposes only what it created, once, leaving the source block's resources alone", () => {
    const look = appearance();
    const shared = [
      vi.spyOn(look.geometry, "dispose"),
      vi.spyOn(look.extras![0].geometry, "dispose"),
      vi.spyOn(look.extras![0].material as THREE.Material, "dispose"),
      ...look.faces.map((face) => vi.spyOn(face, "dispose")),
    ];
    for (const [name, config] of [
      ["wireframe", {}],
      ["faceFree", {}],
      ["laserCube", { colour: 0x65f4dd }],
    ] as const) {
      const endpoint = ghostStyles.get(name).create({ appearance: look, size: 1 }, config);
      const owned: THREE.Material[] = [];
      endpoint.object.traverse((child) => {
        const material = (child as THREE.Mesh).material as THREE.Material | undefined;
        if (material && !look.extras!.some((extra) => extra.material === material))
          owned.push(material);
      });
      const spies = owned.map((material) => vi.spyOn(material, "dispose"));
      endpoint.dispose();
      endpoint.dispose();
      for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    }
    for (const spy of shared) expect(spy).not.toHaveBeenCalled();
  });
});
