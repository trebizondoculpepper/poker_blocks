import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { containedContents, containedResidues, createInteriorBoundary } from "./contained";
import "./filled-vessel";
import "./fading-film";

const geometry = new THREE.BoxGeometry(1, 1, 1);
const fluidConfig = {
  level: 0.45,
  settleSeconds: 0.01,
  look: { id: "opaqueFluid", config: { fill: 0xf2c84b, surface: 0xfadf7e } },
};
const filmConfig = { fill: 0xf2c84b, opacity: 0.45, seconds: 1, resolution: 8 };

function vessel() {
  const boundary = createInteriorBoundary(geometry, 1, 0.92);
  const fluid = containedContents.get("levellingFluid")(boundary, fluidConfig);
  const film = containedResidues.get("fadingFilm").build(boundary, fluid.capabilities, filmConfig);
  const data = () =>
    (
      (film.meshes[0]!.material as THREE.ShaderMaterial).uniforms.history!
        .value as THREE.DataTexture
    ).image.data as Uint8Array;
  const step = (rotation: THREE.Quaternion, seconds: number, delta: number, first = false) => {
    const frame = { rotation, seconds, delta, first };
    fluid.update!(frame);
    film.update!(frame);
  };
  return { step, data, film };
}

const level = new THREE.Quaternion();
const upsideDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);

describe("fading film (#334)", () => {
  it("coats the wetted wall, then fades exposed patches by their own age", () => {
    const { step, data } = vessel();
    step(level, 0, 0, true);
    const wet = [...data()].filter((value) => value === 255).length;
    expect(wet).toBeGreaterThan(0);
    // Turn it over and let the fluid settle: the old wet walls are exposed and start fading.
    for (let t = 1; t <= 5; t++) step(upsideDown, t * 0.1, 0.1);
    const fading = [...data()].filter((value) => value > 0 && value < 255);
    expect(fading.length).toBeGreaterThan(0);
    // After long enough, exposed patches fade to nothing while wet ones stay full.
    for (let t = 6; t <= 80; t++) step(upsideDown, t * 0.1, 0.1);
    expect([...data()].every((value) => value === 0 || value === 255)).toBe(true);
  });

  it("refreshes a patch to full strength when it is wetted again", () => {
    const { step, data } = vessel();
    step(level, 0, 0, true);
    const wetIndex = [...data()].indexOf(255);
    for (let t = 1; t <= 10; t++) step(upsideDown, t * 0.1, 0.1);
    expect(data()[wetIndex]).toBeLessThan(255);
    for (let t = 11; t <= 20; t++) step(level, t * 0.1, 0.1);
    expect(data()[wetIndex]).toBe(255);
  });

  it("keeps each vessel's own history", () => {
    const a = vessel();
    const b = vessel();
    a.step(level, 0, 0, true);
    b.step(level, 0, 0, true);
    for (let t = 1; t <= 10; t++) {
      a.step(upsideDown, t * 0.1, 0.1);
      b.step(level, t * 0.1, 0.1);
    }
    expect([...a.data()]).not.toEqual([...b.data()]);
  });

  it("costs one byte per texel and releases its texture with its material", () => {
    const { film, data } = vessel();
    expect(data().byteLength).toBe(8 * 8 * 6);
    const material = film.meshes[0]!.material as THREE.ShaderMaterial;
    const texture = material.uniforms.history!.value as THREE.DataTexture;
    let disposed = false;
    texture.addEventListener("dispose", () => (disposed = true));
    material.dispose();
    expect(disposed).toBe(true);
  });
});

describe("fading film is frame-rate independent (#412 review)", () => {
  it("fades at the configured rate whether stepped at 10 fps or 240 fps", () => {
    // The film alone, against a surface switched directly, so only its own fading is timed.
    const fadeAfter = (fps: number) => {
      const boundary = createInteriorBoundary(geometry, 1, 0.92);
      const surface = {
        normal: new THREE.Vector3(0, 1, 0),
        height: 10,
        wet: (point: THREE.Vector3) => point.y <= surface.height,
      };
      const film = containedResidues
        .get("fadingFilm")
        .build(boundary, { liquidSurface: surface }, filmConfig);
      const data = () =>
        (
          (film.meshes[0]!.material as THREE.ShaderMaterial).uniforms.history!
            .value as THREE.DataTexture
        ).image.data as Uint8Array;
      film.update!({ rotation: level, seconds: 0, delta: 0, first: true });
      surface.height = -10; // drained: every texel exposed from now on
      for (let frame = 1; frame <= fps; frame++)
        film.update!({ rotation: level, seconds: frame / fps, delta: 1 / fps, first: false });
      return data()[0]!;
    };
    // Configured 1 s fade: exp(-1) of full strength after a second (about 94 of 255).
    expect(fadeAfter(10)).toBeGreaterThanOrEqual(92);
    expect(fadeAfter(10)).toBeLessThanOrEqual(95);
    expect(fadeAfter(240)).toBeGreaterThanOrEqual(92);
    expect(fadeAfter(240)).toBeLessThanOrEqual(95);
  });
});
