import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { createRefractionFront, refractionPresets } from "./crystal-refraction";
import {
  createFaceRippleState,
  defaultFaceRipple,
  faceRippleEnvelope,
  faceRippleNormal,
  stepFaceRipple,
} from "./face-ripple";

const turn = (radians: number) =>
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), radians);
const top = new THREE.Vector3(0, 1, 0);

describe("rotation-triggered concentric highlight ripples (#797)", () => {
  it("is flat at rest and with zero strength: the facet normal exactly", () => {
    const at = new THREE.Vector3(0.2, 0.5, -0.1);
    expect(faceRippleNormal(at, top, { strength: 0.016, envelope: 0, time: 0, half: 0.5 })).toEqual(
      top,
    );
    expect(faceRippleNormal(at, top, { strength: 0, envelope: 1, time: 0, half: 0.5 })).toEqual(
      top,
    );
  });

  it("bends the highlight normal radially about each face's own centre, smoothly at the centre", () => {
    const uniforms = { strength: 0.016, envelope: 1, time: 0, half: 0.5 };
    // Exactly at the face centre: undisturbed, no division by zero.
    const centre = faceRippleNormal(new THREE.Vector3(0, 0.5, 0), top, uniforms);
    expect(centre.distanceTo(top)).toBeLessThan(1e-9);
    // Off centre, the tilt lies along the radial direction in the tangent plane.
    const off = faceRippleNormal(new THREE.Vector3(0.1, 0.5, 0), top, uniforms);
    expect(off.z).toBeCloseTo(0, 9);
    expect(Math.abs(off.x)).toBeGreaterThan(0.01);
    // A side face centres on its own centre, not the cube's.
    const side = new THREE.Vector3(1, 0, 0);
    const onSide = faceRippleNormal(new THREE.Vector3(0.5, 0.1, 0), side, uniforms);
    expect(onSide.z).toBeCloseTo(0, 9);
    expect(Math.abs(onSide.y)).toBeGreaterThan(0.01);
  });

  it("matches the gradient of its radial height field", () => {
    const uniforms = { strength: 0.016, envelope: 0.7, time: 0.3, half: 0.5 };
    const { rings, ringsPerSecond } = defaultFaceRipple;
    const k = (2 * Math.PI * rings) / uniforms.half;
    const height = (r: number) =>
      uniforms.strength *
      uniforms.envelope *
      Math.sin(k * r - 2 * Math.PI * ringsPerSecond * uniforms.time);
    const r = 0.2; // beyond the centre taper
    const bent = faceRippleNormal(new THREE.Vector3(r, 0.5, 0), top, uniforms);
    const e = 1e-6;
    const slope = (height(r + e) - height(r - e)) / (2 * e);
    // n − ∇h, normalised: the x component is −slope / |(−slope, 1)|.
    expect(bent.x).toBeCloseTo(-slope / Math.hypot(slope, 1), 6);
  });

  it("is set off by the object's own turn, bounded, and settles flat after the rest duration", () => {
    const state = createFaceRippleState();
    const step = (clock: number, radians: number, reducedMotion = false) =>
      stepFaceRipple(state, defaultFaceRipple, { clock, rotation: turn(radians), reducedMotion });
    step(0, 0);
    expect(state.level).toBe(0);
    // Standing still (a camera orbit leaves the object's rotation alone): nothing.
    step(1, 0);
    expect(state.level).toBe(0);
    // Repeated big turns saturate at full excitation.
    for (let i = 1; i <= 10; i++) step(1 + i * 0.01, i * 1.5);
    expect(state.level).toBe(1);
    // 45 units (3 s) later it is flat, exactly.
    step(1.1 + 1.5, 15);
    expect(state.level).toBeGreaterThan(0);
    expect(faceRippleEnvelope(state.level)).toBeGreaterThan(0);
    step(1.1 + 3, 15);
    expect(state.level).toBe(0);
    expect(faceRippleEnvelope(state.level)).toBe(0);
  });

  it("holds flat under reduced motion", () => {
    const state = createFaceRippleState();
    stepFaceRipple(state, defaultFaceRipple, { clock: 0, rotation: turn(0), reducedMotion: true });
    stepFaceRipple(state, defaultFaceRipple, {
      clock: 0.1,
      rotation: turn(2),
      reducedMotion: true,
    });
    expect(state.level).toBe(0);
  });

  it("gives each block its own excitation, and leaves refraction's normal alone", () => {
    const preset = refractionPresets.get("calmWater");
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const a = createRefractionFront(preset, geometry);
    const b = createRefractionFront(preset, geometry);
    expect(a.uniforms.faceRippleEnvelope).not.toBe(b.uniforms.faceRippleEnvelope);
    expect(a.uniforms.faceRippleHalf!.value).toBe(0.5);
    // Only the reflection reads the rippled normal; refraction and Fresnel read the flat one.
    expect(a.fragmentShader).toContain("reflect(-v, highlightNormal())");
    expect(a.fragmentShader).toContain("vec3 n = normalize(vWorldNormal);");
    // Turning one block excites it alone.
    const meshA = new THREE.Mesh(geometry, a);
    const meshB = new THREE.Mesh(geometry, b);
    const draw = (mesh: THREE.Mesh, material: THREE.ShaderMaterial) =>
      material.onBeforeRender(
        null as never,
        null as never,
        null as never,
        geometry,
        mesh,
        null as never,
      );
    draw(meshA, a);
    draw(meshB, b);
    preset.ripple.advance({ delta: 0.1, reducedMotion: false });
    meshA.rotation.y = 1;
    meshA.updateMatrixWorld();
    draw(meshA, a);
    draw(meshB, b);
    expect(a.uniforms.faceRippleEnvelope!.value).toBeGreaterThan(0);
    expect(b.uniforms.faceRippleEnvelope!.value).toBe(0);
  });

  it("gives a preset with no surface strength no per-block ripple", () => {
    const front = createRefractionFront(refractionPresets.get("crystal"), new THREE.BoxGeometry());
    expect(front.uniforms.faceRippleEnvelope!.value).toBe(0);
    expect(front.uniforms.rippleSurface!.value).toBe(0);
  });
});
