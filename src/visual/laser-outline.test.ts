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
  it("has finite tube vertices, preserves opacity and allows zero scroll with nonzero evolution", () => {
    const source = new THREE.BoxGeometry(2, 2, 2);
    const outline = createLaserOutline(source, 0xffffff, 2, {
      scroll: 0,
      evolution: 0.4,
      sway: { amount: 0, rate: 1 },
    });
    for (const child of outline.object.children) {
      const positions = (child as THREE.Mesh).geometry.getAttribute("position");
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
    }
    outline.update(5);
    expect(outline.material.uniforms.offset!.value.toArray()).toEqual([0, 2]);
    outline.material.opacity = 0.25;
    outline.update(2);
    expect(outline.material.uniforms.opacity!.value).toBe(0.25);
    outline.dispose();
    source.dispose();
  });

  it("reads one shared tileable noise texture, scrolled with a sinusoidal sway (#467)", async () => {
    const { laserNoiseTexture } = await import("./laser-outline");
    const source = new THREE.BoxGeometry(1, 1, 1);
    const a = createLaserOutline(source, 0xffffff, 1);
    const b = createLaserOutline(source, 0xffffff, 1, {
      scroll: 0.5,
      evolution: 0,
      sway: { amount: 0.1, rate: 2 },
    });
    expect(a.material.uniforms.noise!.value).toBe(laserNoiseTexture());
    expect(b.material.uniforms.noise!.value).toBe(a.material.uniforms.noise!.value);
    expect(laserNoiseTexture().wrapS).toBe(THREE.RepeatWrapping);
    b.update(1);
    const [u, v] = b.material.uniforms.offset!.value.toArray();
    expect(u).toBeCloseTo(0.5 + 0.1 * Math.sin(2));
    expect(v).toBeCloseTo(0.1 * Math.cos(2 * 0.73));
    // Reduced motion holds the haze still.
    b.update(9, true);
    expect(b.material.uniforms.offset!.value.toArray()).toEqual([u, v]);
    a.dispose();
    b.dispose();
    source.dispose();
  });
});
