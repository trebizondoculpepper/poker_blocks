/**
 * Rotation-triggered concentric highlight ripples (#797; doc/calm-water-refinements.md,
 * "Rotation-triggered concentric highlight ripples"). A registered appearance capability: on
 * each planar face, rings spread outward from the face's own centre while the object turns, then
 * settle back to a flat surface within a configured rest duration.
 *
 * - **Pattern.** A deterministic radial height field about each face's centre, measured in the
 *   object's local space in the face's tangent plane: h = A·e·sin(k·r − ω·t), with k giving the
 *   configured number of rings across half a face. Its analytic gradient bends the *highlight*
 *   normal only; refraction, magnification, dispersion and Fresnel keep the flat facet normal.
 *   The centre is tapered smoothly, so nothing divides by zero there.
 * - **Excitation.** Each displayed object keeps its own level (0–1). Turning the object (its own
 *   world rotation, never the camera's) raises it in proportion to the angle turned, capped at 1,
 *   so repeated turns can't grow the amplitude without bound. It falls linearly to zero over the
 *   rest duration, and the amplitude follows a smoothstep of the level, so it eases out and is
 *   exactly zero at rest.
 * - **Clock.** It runs on the host's one presentation clock (the seconds the preset's ripple is
 *   advanced by), never wall-clock deadlines or frame counts. Reduced motion holds it flat.
 *
 * Definitions are immutable and shared; each object's state is its own and goes with it.
 */
import * as THREE from "three";
import { unitMs } from "../visual-events/scheduler";

export type FaceRippleConfig = {
  /** Rings across half a face. */
  rings: number;
  /** Game-time units from full excitation back to a flat surface. */
  restUnits: number;
  /** How fast the rings travel outward, in rings per second. */
  ringsPerSecond: number;
  /** Excitation gained per radian the object turns. */
  gainPerRadian: number;
};

/** The reversible audition defaults the design names: two rings, 45 units (3 s) to rest. */
export const defaultFaceRipple: FaceRippleConfig = {
  rings: 2,
  restUnits: 45,
  ringsPerSecond: 1.5,
  gainPerRadian: 1.5,
};

/** One displayed object's ripple: its own excitation and travel phase. */
export type FaceRippleState = {
  /** Excitation, 0 (flat) to 1. */
  level: number;
  /** Seconds the rings have travelled. */
  time: number;
  /** The presentation clock at the last step, or null before the first. */
  clock: number | null;
  /** The object's world rotation at the last step, or null before the first. */
  rotation: THREE.Quaternion | null;
};

export const createFaceRippleState = (): FaceRippleState => ({
  level: 0,
  time: 0,
  clock: null,
  rotation: null,
});

/** The amplitude factor for an excitation level: smooth, and exactly zero at rest. */
export const faceRippleEnvelope = (level: number): number => {
  const l = Math.min(1, Math.max(0, level));
  return l * l * (3 - 2 * l);
};

/**
 * Step one object's ripple to the presentation clock `clock` (seconds), given its current world
 * rotation. Turning raises the level (bounded at 1); time lets it fall back to rest. Reduced
 * motion holds the surface flat.
 */
export function stepFaceRipple(
  state: FaceRippleState,
  config: FaceRippleConfig,
  frame: { clock: number; rotation: THREE.Quaternion; reducedMotion: boolean },
): void {
  const delta = state.clock === null ? 0 : Math.max(0, frame.clock - state.clock);
  const turned = state.rotation === null ? 0 : state.rotation.angleTo(frame.rotation);
  state.clock = frame.clock;
  state.rotation = (state.rotation ?? new THREE.Quaternion()).copy(frame.rotation);
  if (frame.reducedMotion) {
    state.level = 0;
    return;
  }
  const restSeconds = Math.max(1e-6, (config.restUnits * unitMs) / 1000);
  state.level = Math.min(
    1,
    Math.max(0, state.level - delta / restSeconds) + turned * config.gainPerRadian,
  );
  // Exactly flat at the rest duration: no floating-point residue keeps it trembling.
  if (state.level < 1e-9) state.level = 0;
  state.time = state.level > 0 ? state.time + delta : 0;
}

/**
 * GLSL declaring the per-object uniforms and `vec3 faceRippleNormal(vec3 local, vec3 normal)`:
 * the local-space highlight normal of the facet at `local` with flat normal `normal`. At zero
 * strength or envelope it is `normal` exactly.
 */
export const faceRippleGlsl = /* glsl */ `
  uniform float rippleSurface;
  uniform float faceRippleEnvelope;
  uniform float faceRippleTime;
  uniform float faceRippleRings;
  uniform float faceRippleSpeed;
  uniform float faceRippleHalf;
  vec3 faceRippleNormal(vec3 local, vec3 normal) {
    float amplitude = rippleSurface * faceRippleEnvelope;
    if (amplitude <= 0.0) return normal;
    // The point's offset from its own face's centre, in that face's tangent plane.
    vec3 offset = local - dot(local, normal) * normal;
    float r = length(offset);
    float halfSize = max(faceRippleHalf, 1e-4);
    float k = 6.283185307179586 * faceRippleRings / halfSize;
    float wave = cos(k * r - 6.283185307179586 * faceRippleSpeed * faceRippleTime);
    // Tapered to zero at the centre, where the radial direction is undefined.
    float taper = smoothstep(0.0, 0.1 * halfSize, r);
    vec3 gradient = amplitude * k * wave * taper * offset / max(r, 1e-5);
    return normalize(normal - gradient);
  }
`;

/** The same highlight normal on the CPU, for tests: matches `faceRippleNormal` in the GLSL. */
export function faceRippleNormal(
  local: THREE.Vector3,
  normal: THREE.Vector3,
  uniforms: { strength: number; envelope: number; time: number; half: number },
  config: FaceRippleConfig = defaultFaceRipple,
): THREE.Vector3 {
  const amplitude = uniforms.strength * uniforms.envelope;
  if (amplitude <= 0) return normal.clone();
  const offset = local.clone().sub(normal.clone().multiplyScalar(local.dot(normal)));
  const r = offset.length();
  const half = Math.max(uniforms.half, 1e-4);
  const k = (2 * Math.PI * config.rings) / half;
  const wave = Math.cos(k * r - 2 * Math.PI * config.ringsPerSecond * uniforms.time);
  const edge = Math.min(1, Math.max(0, r / (0.1 * half)));
  const taper = edge * edge * (3 - 2 * edge);
  const gradient = offset.multiplyScalar((amplitude * k * wave * taper) / Math.max(r, 1e-5));
  return normal.clone().sub(gradient).normalize();
}

/** The per-object uniforms the GLSL above reads, besides the preset's shared strength. */
export type FaceRippleUniforms = {
  faceRippleEnvelope: { value: number };
  faceRippleTime: { value: number };
  faceRippleRings: { value: number };
  faceRippleSpeed: { value: number };
  faceRippleHalf: { value: number };
};

/**
 * Give one object's material its own ripple: its own uniforms, and a per-draw step that reads the
 * object's world rotation and the preset's presentation clock. `clock` and `reducedMotion` come
 * from the host's frame (the preset ripple's advance).
 */
export function attachFaceRipple(
  material: THREE.ShaderMaterial,
  geometry: THREE.BufferGeometry,
  config: FaceRippleConfig,
  frame: () => { clock: number; reducedMotion: boolean },
): FaceRippleState {
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3());
  const uniforms: FaceRippleUniforms = {
    faceRippleEnvelope: { value: 0 },
    faceRippleTime: { value: 0 },
    faceRippleRings: { value: config.rings },
    faceRippleSpeed: { value: config.ringsPerSecond },
    faceRippleHalf: { value: Math.max(size.x, size.y, size.z) / 2 },
  };
  Object.assign(material.uniforms, uniforms);
  const state = createFaceRippleState();
  const rotation = new THREE.Quaternion();
  material.onBeforeRender = (_renderer, _scene, _camera, _geometry, object) => {
    const { clock, reducedMotion } = frame();
    // Several draws in one frame see no time pass and no further turn.
    if (state.clock !== clock || !state.rotation?.equals(object.getWorldQuaternion(rotation)))
      stepFaceRipple(state, config, {
        clock,
        rotation: object.getWorldQuaternion(rotation),
        reducedMotion,
      });
    uniforms.faceRippleEnvelope.value = faceRippleEnvelope(state.level);
    uniforms.faceRippleTime.value = state.time;
    material.uniformsNeedUpdate = true;
  };
  return state;
}
