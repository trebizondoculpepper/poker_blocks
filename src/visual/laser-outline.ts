import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { additiveLight } from "./additive-light";

export type LaserOutlineConfig = {
  /** Noise patches across the outlined object's size: higher is busier. */
  frequency: number;
  /** Steady scroll along the noise, in texture widths per second. */
  scroll: number;
  /** How fast the pattern changes: scroll across the noise's rows, texture widths per second. */
  evolution: number;
  /** A sinusoidal sway on top of the scroll: its size (texture widths) and rate (radians/s). */
  sway: { amount: number; rate: number };
  /** Radii as a fraction of the outlined object's size. */
  coreRadius: number;
  glowRadius: number;
};
export const defaultLaserOutline: LaserOutlineConfig = {
  frequency: 0.9,
  scroll: 0.05,
  evolution: 0.12,
  sway: { amount: 0.08, rate: 0.9 },
  coreRadius: 0.004,
  glowRadius: 0.025,
};

/** Texels along each side of the shared noise texture. */
const noiseSize = 64;
let sharedNoise: THREE.DataTexture | null = null;

/**
 * One small tileable 2D value-noise texture (two octaves), made once and shared by every laser
 * outline: the haze the beam shows. Each edge samples a line through it; scrolling the texture
 * moves and changes the haze, so the shader does one texture read per pixel.
 */
export function laserNoiseTexture(): THREE.DataTexture {
  if (sharedNoise) return sharedNoise;
  let seed = 0x9e3779b9;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const octave = (cells: number) => {
    const lattice = Array.from({ length: cells * cells }, random);
    const at = (x: number, y: number) => lattice[(y % cells) * cells + (x % cells)]!;
    const smooth = (t: number) => t * t * (3 - 2 * t);
    return (x: number, y: number) => {
      const fx = (x / noiseSize) * cells,
        fy = (y / noiseSize) * cells;
      const x0 = Math.floor(fx),
        y0 = Math.floor(fy);
      const tx = smooth(fx - x0),
        ty = smooth(fy - y0);
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
      const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
      return top + (bottom - top) * ty;
    };
  };
  const coarse = octave(8),
    fine = octave(16);
  const data = new Uint8Array(noiseSize * noiseSize);
  for (let y = 0; y < noiseSize; y++)
    for (let x = 0; x < noiseSize; x++)
      data[y * noiseSize + x] = Math.round((0.65 * coarse(x, y) + 0.35 * fine(x, y)) * 255);
  const texture = new THREE.DataTexture(data, noiseSize, noiseSize, THREE.RedFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  sharedNoise = texture;
  return texture;
}

/** One shared shader/geometry pair per outline; no simulation per edge or per clone. */
export function createLaserOutline(
  source: THREE.BufferGeometry,
  colour: number,
  size: number,
  options: Partial<LaserOutlineConfig> = {},
) {
  const edges = new THREE.EdgesGeometry(source);
  const lines = createLaserLines(edges, colour, size, options);
  const dispose = lines.dispose;
  return {
    ...lines,
    dispose() {
      dispose();
      edges.dispose();
    },
  };
}

/**
 * Laser beams along arbitrary line segments (#498): `segments` holds pairs of points, as an
 * EdgesGeometry or LineSegments geometry does. The outline above is its edges; a drop guide's
 * rectangle or cross is its own segments. It leaves `segments` alone.
 */
export function createLaserLines(
  segments: THREE.BufferGeometry,
  colour: number,
  size: number,
  options: Partial<LaserOutlineConfig> = {},
) {
  const config = { ...defaultLaserOutline, ...options };
  const positions = segments.getAttribute("position");
  const uniforms = {
    time: { value: 0 },
    tint: { value: new THREE.Color(colour) },
    opacity: { value: 1 },
    frequency: { value: config.frequency / size },
    noise: { value: laserNoiseTexture() },
    // Where the edges read the noise this frame: scroll and evolution, plus the sway.
    offset: { value: new THREE.Vector2() },
  };
  const object = new THREE.Group();
  const up = new THREE.Vector3(0, 1, 0);
  function tubes(radius: number): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    for (let index = 0; index < positions.count; index += 2) {
      const start = new THREE.Vector3().fromBufferAttribute(positions, index);
      const end = new THREE.Vector3().fromBufferAttribute(positions, index + 1);
      const direction = end.clone().sub(start);
      const tube = new THREE.CylinderGeometry(
        radius * size,
        radius * size,
        direction.length(),
        10,
        1,
        true,
      );
      tube.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()));
      tube.translate(...start.add(end).multiplyScalar(0.5).toArray());
      parts.push(tube);
    }
    const geometry = mergeGeometries(parts)!;
    parts.forEach((part) => part.dispose());
    return geometry;
  }
  function material(strength: number) {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      ...additiveLight,
      uniforms: { ...uniforms, strength: { value: strength } },
      vertexShader: `varying vec3 edgePosition; varying vec3 surfaceNormal; varying vec3 viewDirection;
        void main() { vec4 view = modelViewMatrix * vec4(position,1.0);
          edgePosition = position; surfaceNormal = normalMatrix * normal; viewDirection = -view.xyz;
          gl_Position = projectionMatrix * view; }`,
      // Each edge is a line through the noise: two fixed directions turn its position into
      // texture coordinates, so every edge reads its own line and the corners stay continuous.
      fragmentShader: `uniform float frequency,opacity,strength; uniform vec2 offset;
        uniform vec3 tint; uniform sampler2D noise;
        varying vec3 edgePosition; varying vec3 surfaceNormal; varying vec3 viewDirection;
        void main() {
          vec2 uv = vec2(dot(edgePosition, vec3(.71,.53,.37)), dot(edgePosition, vec3(-.29,.61,.83)));
          float haze = texture2D(noise, uv*frequency + offset).r;
          float density = smoothstep(.3,.72, haze);
          float radial = pow(max(0.0,dot(normalize(surfaceNormal),normalize(viewDirection))),1.7);
          float light = (.05 + density*1.5) * radial * strength * opacity;
          gl_FragColor = vec4(mix(tint,vec3(1.0),density*.4)*light,clamp(light,0.0,1.0));
        }`,
    });
  }
  const coreGeometry = tubes(config.coreRadius),
    glowGeometry = tubes(config.glowRadius);
  const core = material(1),
    glow = material(0.18);
  const coreMesh = new THREE.Mesh(coreGeometry, core),
    glowMesh = new THREE.Mesh(glowGeometry, glow);
  coreMesh.renderOrder = glowMesh.renderOrder = 12;
  // Opacity is presentation state owned by the caller (including release fades).
  coreMesh.onBeforeRender = glowMesh.onBeforeRender = () => {
    uniforms.opacity.value = core.opacity;
  };
  object.add(glowMesh, coreMesh);
  let disposed = false;
  return {
    object,
    material: core,
    update(seconds: number, reducedMotion = false) {
      if (!reducedMotion) {
        uniforms.time.value = seconds;
        const sway = config.sway.amount;
        uniforms.offset.value.set(
          config.scroll * seconds + sway * Math.sin(config.sway.rate * seconds),
          config.evolution * seconds + sway * Math.cos(config.sway.rate * 0.73 * seconds),
        );
      }
      uniforms.opacity.value = core.opacity;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      coreGeometry.dispose();
      glowGeometry.dispose();
      core.dispose();
      glow.dispose();
      object.removeFromParent();
      object.clear();
    },
  };
}
