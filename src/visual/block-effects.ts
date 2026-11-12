/**
 * Ongoing block effects (#464, #465): looks that keep emitting while a block is on the table,
 * such as smoke or dust. A material's appearance lists them (`effects`), each naming a handler
 * registered here with its own serializable configuration, so the view that hosts them never
 * names an effect or a material. See doc/game-architecture.md, "Ongoing block effects".
 *
 * Each effect's `object` lives in a world-space layer the host owns, never on the block, so what
 * it has emitted stays put as the block moves or turns. `update` reads the block's live world
 * matrix, so only new particles start from its current pose. Cosmetic only.
 */
import * as THREE from "three";
import { Registry } from "../core/registry";

/** One effect a material's look lists: a registered handler and its configuration. */
export type AppearanceEffect = { effect: string } & Record<string, unknown>;

export type BlockEffect = {
  /** Added to the host's world-space layer. */
  object: THREE.Object3D;
  /** Per frame: emit from `block`'s current pose and age what was emitted. */
  update(delta: number, block: THREE.Object3D, reducedMotion: boolean): void;
  dispose(): void;
};

export type BlockEffectContext = {
  /** A cosmetic random source, never the session's seeded stream. */
  random: () => number;
  /** The block's edge length in world units; configured distances are in block sizes. */
  size: number;
};

export type BlockEffectHandler = (
  config: AppearanceEffect,
  context: BlockEffectContext,
) => BlockEffect;

export const blockEffects = new Registry<BlockEffectHandler>("block effect");

/** Where cosmetic randomness comes from: `Math.random` unless a tool asks for a fixed stream. */
// Looked up at each call, not captured: a test that stubs Math.random still reaches it.
let cosmeticSource: () => number = () => Math.random();

/** Cosmetic randomness for effects: presentation, never the session's stream. */
export const cosmeticRandom = (): number => cosmeticSource();

/**
 * Draw cosmetic randomness from `source` until the returned function restores the previous one:
 * a profiler uses this so a case's stars, bubbles and grass repeat exactly from run to run (#653).
 */
export function useCosmeticRandom(source: () => number): () => void {
  const previous = cosmeticSource;
  cosmeticSource = source;
  return () => {
    cosmeticSource = previous;
  };
}

/** Build every effect a look lists. */
export function createBlockEffects(
  effects: readonly AppearanceEffect[],
  context: BlockEffectContext,
): BlockEffect[] {
  return effects.map((config) => blockEffects.get(config.effect)(config, context));
}

/** Shared by every emitter: immutable, built once, never freed. */
let puffTexture: THREE.DataTexture | null = null;

/** A soft round puff, dense in the middle and fading to nothing at the rim. Shared, never freed. */
function puff(): THREE.DataTexture {
  if (puffTexture) return puffTexture;
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
      const alpha = r >= 1 ? 0 : (1 - r * r) ** 2;
      data.set([255, 255, 255, Math.round(alpha * 255)], (y * n + x) * 4);
    }
  puffTexture = new THREE.DataTexture(data, n, n);
  puffTexture.magFilter = puffTexture.minFilter = THREE.LinearFilter;
  puffTexture.needsUpdate = true;
  // Shared: never freed with one block's resources (#653 review).
  puffTexture.userData.shared = true;
  return puffTexture;
}

const vertex = /* glsl */ `
  attribute float puffSize;
  attribute float puffAlpha;
  varying float vAlpha;
  uniform float scale;
  void main() {
    vAlpha = puffAlpha;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = puffSize * scale / -view.z;
  }
`;
const fragment = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 colour;
  varying float vAlpha;
  void main() {
    float a = texture2D(map, gl_PointCoord).a * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(colour, a);
  }
`;

/**
 * One emitter's particles: a pool of `capacity` soft round points, each with its own world
 * position, world size and opacity, in one colour. The emitter writes the arrays and calls
 * `commit` each frame. Its geometry and material are its own; the texture is shared.
 */
export function createParticles(capacity: number, colour: number) {
  const positions = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const alphas = new Float32Array(capacity);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("puffSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("puffAlpha", new THREE.BufferAttribute(alphas, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: puff() },
      colour: { value: new THREE.Color(colour) },
      scale: { value: 1 },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  // Sized in world units under the table's perspective camera: scale by the drawing buffer's
  // height (device pixels, as gl_PointSize is) and the lens.
  const buffer = new THREE.Vector2();
  points.onBeforeRender = (renderer, _scene, camera) => {
    const height = renderer.getDrawingBufferSize(buffer).y;
    const lens = camera.projectionMatrix.elements[5] ?? 1;
    material.uniforms.scale!.value = (height / 2) * lens;
  };
  return {
    points,
    positions,
    sizes,
    alphas,
    commit: () => {
      geometry.attributes.position!.needsUpdate = true;
      geometry.attributes.puffSize!.needsUpdate = true;
      geometry.attributes.puffAlpha!.needsUpdate = true;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** A bounded sideways swirl: two slow sines, each at most half of `turbulence`. */
export function swirl(age: number, phase: number, rate: number): number {
  return 0.5 * Math.sin(age * rate + phase);
}
