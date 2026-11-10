import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { createLaserOutline } from "./laser-outline";

describe("coherent laser outline", () => {
  it("keeps the source geometry untouched and shares the evolving clock across core and halo", () => {
    const source = new THREE.BoxGeometry(2, 2, 2);
    const sourceDispose = vi.spyOn(source, "dispose");
    const outline = createLaserOutline(source, 0x65f4dd, 2);
    const materials = outline.object.children.map(
      (mesh) => (mesh as THREE.Mesh).material as THREE.ShaderMaterial,
    );
    expect(materials).toHaveLength(2);
    expect(materials[0]!.uniforms.time).toBe(materials[1]!.uniforms.time);
    outline.update(2);
    expect(outline.material.uniforms.time!.value).toBe(2);
    outline.update(7, true);
    expect(outline.material.uniforms.time!.value).toBe(2);
    outline.update(8);
    expect(outline.material.uniforms.time!.value).toBe(8);
    const dispose = materials.map((material) => vi.spyOn(material, "dispose"));
    outline.dispose();
    outline.dispose();
    dispose.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    expect(sourceDispose).not.toHaveBeenCalled();
    source.dispose();
  });
  it("has finite tube vertices, preserves opacity and allows zero drift with nonzero evolution", () => {
    const source = new THREE.BoxGeometry(2, 2, 2);
    const outline = createLaserOutline(source, 0xffffff, 2, { drift: [0, 0, 0], evolution: 0.4 });
    for (const child of outline.object.children) {
      const positions = (child as THREE.Mesh).geometry.getAttribute("position");
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
    }
    expect(outline.material.uniforms.drift!.value.toArray()).toEqual([0, 0, 0]);
    expect(outline.material.uniforms.evolution!.value).toBe(0.4);
    outline.material.opacity = 0.25;
    outline.update(2);
    expect(outline.material.uniforms.opacity!.value).toBe(0.25);
    outline.dispose();
    source.dispose();
  });
});
