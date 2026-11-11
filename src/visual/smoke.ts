/**
 * Smoke (#464): puffs that rise along world up from a block's centre, wherever the block is and
 * however it is turned. Puffs already emitted stay in world space, so a moving block leaves a
 * trail. See doc/game-architecture.md, "Ongoing block effects".
 *
 * - Emits `frequency` puffs a second, carrying fractions over between frames.
 * - Each rises at `rise` block sizes a second (±20%); `turbulence` is a bounded two-sine swirl
 *   sideways that never slows the rise. No fluid simulation.
 * - A puff grows from `size` toward twice that and fades over `lifetime`, at most `opacity`.
 * - A fixed pool recycles the oldest puff. Reduced motion emits nothing new.
 */
import * as THREE from "three";
import { blockEffects, type AppearanceEffect, type BlockEffectContext } from "./block-effects";

export type SmokeConfig = {
  /** The smoke's colour (hex). */
  colour: number;
  /** A puff's starting size, in block sizes. */
  size: number;
  /** Puffs emitted a second. */
  frequency: number;
  /** Rise speed, in block sizes a second. */
  rise: number;
  /** Seconds a puff lives. */
  lifetime: number;
  /** The widest sideways swirl, in block sizes. */
  turbulence: number;
  /** A puff's opacity at its densest. */
  opacity: number;
};

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

/** A smoke emitter: its own bounded pool, geometry and material. */
export function createSmoke(raw: AppearanceEffect, { random, size }: BlockEffectContext) {
  const config = raw as unknown as SmokeConfig & AppearanceEffect;
  const capacity = Math.ceil(config.frequency * config.lifetime) + 2;
  const positions = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const alphas = new Float32Array(capacity);
  const puffs = Array.from({ length: capacity }, () => ({
    age: Infinity,
    /** Emitted this frame, already aged by the time since. */
    born: false,
    origin: new THREE.Vector3(),
    risen: 0,
    speed: 0,
    phases: [0, 0],
    rates: [0, 0],
  }));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("puffSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("puffAlpha", new THREE.BufferAttribute(alphas, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: puff() },
      colour: { value: new THREE.Color(config.colour) },
      scale: { value: 1 },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  // Puffs are sized in world units under the table's perspective camera: scale by the drawing
  // buffer's height (device pixels, as gl_PointSize is) and the lens.
  points.onBeforeRender = (renderer, _scene, camera) => {
    const height = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    const lens = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5] ?? 1;
    material.uniforms.scale!.value = (height / 2) * lens;
  };

  let owed = 0;
  let next = 0;
  const centre = new THREE.Vector3();

  return {
    object: points,
    update(delta: number, block: THREE.Object3D, reducedMotion: boolean) {
      if (!reducedMotion) {
        owed += config.frequency * delta;
        block.getWorldPosition(centre);
        while (owed >= 1) {
          owed -= 1;
          const p = puffs[next]!;
          // Born partway through the frame: only the time since then has passed for it, so
          // puffs emitted in one frame have their own ages rather than clumping.
          p.age = Math.min(delta, owed / config.frequency);
          p.born = true;
          p.origin.copy(centre);
          p.speed = config.rise * (0.8 + random() * 0.4);
          p.risen = p.speed * p.age;
          p.phases = [random() * Math.PI * 2, random() * Math.PI * 2];
          p.rates = [1.3 + random(), 1.7 + random()];
          next = (next + 1) % capacity;
        }
      }
      puffs.forEach((p, index) => {
        const step = p.born ? 0 : delta;
        p.born = false;
        p.age += step;
        const life = p.age / config.lifetime;
        if (life >= 1) {
          alphas[index] = 0;
          return;
        }
        p.risen += p.speed * step;
        // Two slow sines, each at most half the turbulence: bounded sideways, never downward.
        const sway = (k: 0 | 1) => 0.5 * Math.sin(p.age * p.rates[k] + p.phases[k]);
        positions[index * 3] = p.origin.x + config.turbulence * size * sway(0);
        positions[index * 3 + 1] = p.origin.y + p.risen * size;
        positions[index * 3 + 2] = p.origin.z + config.turbulence * size * sway(1);
        sizes[index] = config.size * size * (1 + life);
        // A quick fade in, then thinning out as it spreads.
        alphas[index] = config.opacity * Math.min(1, 0.15 + life * 6) * (1 - life);
      });
      geometry.attributes.position!.needsUpdate = true;
      geometry.attributes.puffSize!.needsUpdate = true;
      geometry.attributes.puffAlpha!.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

blockEffects.register("smoke", createSmoke);
