import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { getMaterialDefinition } from "../materials";
import { createFacetShell, facetPattern, facetTexture, fillPane } from "./approximate-crystal";
import { opticsBackends, withOpticsBackend } from "./optics-backends";

describe("approximate crystal (#523)", () => {
  it("makes the same seeded facet pattern every time, fully opaque", () => {
    const a = facetPattern(32, 6, 3);
    expect(a).toEqual(facetPattern(32, 6, 3));
    expect(a).not.toEqual(facetPattern(32, 6, 4));
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
  });

  it("shares one facet texture, but gives each block its own shell material to free", () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const one = createFacetShell(geometry);
    const two = createFacetShell(geometry);
    expect(one.material).not.toBe(two.material);
    const uniform = (mesh: THREE.Mesh) =>
      (mesh.material as THREE.ShaderMaterial).uniforms.facets!.value;
    expect(uniform(one)).toBe(facetTexture());
    expect(uniform(two)).toBe(facetTexture());
    // A block frees its extras' materials and their maps; the shared texture is a uniform, not
    // a map, so it survives.
    expect((one.material as THREE.MeshStandardMaterial).map).toBeUndefined();
  });

  it("uses no transmission or fire: one additive back-face shell", () => {
    const shell = createFacetShell(new THREE.BoxGeometry(1, 1, 1));
    const material = shell.material as THREE.ShaderMaterial;
    expect(material.side).toBe(THREE.BackSide);
    expect(material.fragmentShader).not.toContain("refract(");
  });
});

describe("optics backends (#523)", () => {
  it("rebuilds a definition through another look by changing only its assembly", () => {
    const crystal = getMaterialDefinition("prismatic");
    const approximate = withOpticsBackend(crystal, "approximation");
    expect(approximate.appearance.assembly).toBe("approximateCrystal");
    expect({ ...approximate.appearance, assembly: crystal.appearance.assembly }).toEqual(
      crystal.appearance,
    );
    expect(withOpticsBackend(crystal, "current").appearance.assembly).toBe("refractiveCrystal");
    expect(crystal.appearance.assembly).toBe("refractiveCrystal");
  });

  it("states what the approximation cannot show", () => {
    expect(opticsBackends.get("approximation").unsupported).toMatch(/Contained blocks/);
  });
});

describe("the approximation shows filled, coloured facets, not a wireframe (#524)", () => {
  it("fills the face's see-through pane and leaves the art as it was", () => {
    // One clear pane pixel, one opaque art pixel.
    const pixels = new Uint8ClampedArray([0, 0, 0, 0, 160, 30, 50, 255]);
    fillPane(pixels, new THREE.Color(0xffffff));
    // The pane is now a pale, mostly opaque fill instead of nothing.
    expect(pixels[3]).toBeGreaterThanOrEqual(150);
    expect(Math.min(pixels[0]!, pixels[1]!, pixels[2]!)).toBeGreaterThan(200);
    expect(Array.from(pixels.slice(4))).toEqual([160, 30, 50, 255]);
  });

  it("fills each facet with colour; seams are not what dominates", () => {
    const size = 64;
    const data = facetPattern(size, 12, 7);
    let bright = 0;
    let saturated = 0;
    for (let at = 0; at < data.length; at += 4) {
      const [r, g, b] = [data[at]!, data[at + 1]!, data[at + 2]!];
      if (Math.max(r, g, b) > 60) bright++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 40) saturated++;
    }
    const pixels = size * size;
    // Almost every pixel is a lit facet (not a dark interior behind a bright outline)...
    expect(bright / pixels).toBeGreaterThan(0.9);
    // ...and most carry visible colour.
    expect(saturated / pixels).toBeGreaterThan(0.5);
  });
});
