import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import {
  createCrystalV3Front,
  createCrystalV3Rear,
  crystalV3Environment,
  crystalV3Tuning,
  spectralEnvironment,
} from "./crystal-v3";
import { opticsBackends } from "./optics-backends";

// The texture the game uses, at its own resolution.
const width = 256;
const height = 128;
const env = spectralEnvironment(width, height);
const pixel = (x: number, y: number) => {
  const at = (y * width + x) * 4;
  return [env[at]!, env[at + 1]!, env[at + 2]!];
};
const distance = (a: number[], b: number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe("Crystal v3's spectral environment (#645)", () => {
  it("carries real spectral colour, not a grey wash", () => {
    let saturated = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const [r, g, b] = pixel(x, y);
        if (Math.max(r!, g!, b!) - Math.min(r!, g!, b!) > 0.25) saturated++;
      }
    expect(saturated / (width * height)).toBeGreaterThan(0.5);
  });

  it("is smooth: no cells or seams, including where longitude wraps", () => {
    let worst = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        worst = Math.max(worst, distance(pixel(x, y), pixel((x + 1) % width, y)));
        if (y + 1 < height) worst = Math.max(worst, distance(pixel(x, y), pixel(x, y + 1)));
      }
    expect(worst).toBeLessThan(0.15);
    // The wrap seam is no worse than any neighbouring step.
    for (let y = 0; y < height; y++)
      expect(distance(pixel(width - 1, y), pixel(0, y))).toBeLessThan(0.15);
  });
});

describe("Crystal v3's environment at the poles (#647 review)", () => {
  it("has no colour around the top and bottom rows, where all longitudes meet", () => {
    for (const y of [0, height - 1]) {
      const first = pixel(0, y);
      for (let x = 1; x < width; x++) expect(distance(pixel(x, y), first)).toBeLessThan(0.01);
    }
  });
});

describe("Crystal v3's layers (#645)", () => {
  it("draws the rear first, from back faces, and shares the environment and tuning", () => {
    const rear = createCrystalV3Rear(new THREE.BoxGeometry(1, 1, 1));
    const front = createCrystalV3Front();
    const rearMaterial = rear.material as THREE.ShaderMaterial;
    expect(rearMaterial.side).toBe(THREE.BackSide);
    expect(front.side).toBe(THREE.FrontSide);
    // Rear before the front faces (0) and the print (20).
    expect(rear.renderOrder).toBeLessThan(0);
    expect(rearMaterial.uniforms.environment!.value).toBe(crystalV3Environment());
    expect(front.uniforms.frontOffset).toBe(crystalV3Tuning.frontOffset);
    // Each block owns its own materials, freed with it.
    expect(createCrystalV3Front()).not.toBe(front);
  });

  it("uses no refraction, dispersion loop, noise or time-driven shimmer", () => {
    const shaders = [
      (createCrystalV3Rear(new THREE.BoxGeometry(1, 1, 1)).material as THREE.ShaderMaterial)
        .fragmentShader,
      createCrystalV3Front().fragmentShader,
    ].join("\n");
    expect(shaders).not.toMatch(/refract\(|for \(|noise|time/i);
  });

  it("is a registered backend whose tuning controls are its shared uniforms", () => {
    const backend = opticsBackends.get("crystalV3");
    expect(backend.assembly).toBe("crystalV3");
    // A control drives its shared uniform.
    const opacity = backend.controls?.find(({ label }) => label === "Rear opacity");
    if (!opacity || "options" in opacity) throw new Error("Rear opacity should be a slider");
    opacity.set(0.5);
    expect(crystalV3Tuning.rearOpacity.value).toBe(0.5);
    opacity.set(0.92);
  });
});
