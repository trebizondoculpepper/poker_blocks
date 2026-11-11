/**
 * A field of stars inside a container (#349, the Magic Lock proof): the crystal trail's
 * four-pointed star and its lifecycle (src/visual/star-particles.ts) as contained contents.
 *
 * - A fixed pool of stars lives in the interior, each with its own age, so births are staggered
 *   and the population is stable however long it runs. A star that reaches the end of its life
 *   is reborn at a new random place inside.
 * - Each star drifts and fizzes in its own direction, with weak gravity toward world down (turned
 *   into the container's own space every frame, so it follows the vessel as it turns). Walls
 *   deflect it, damped, with a margin for the star's footprint, so none leaks through.
 * - Its colour follows a configured ramp over its life (Magic Lock: brilliant white, cream,
 *   brown, black), drawn additively, so black adds no light and a dying star simply vanishes.
 * - Under reduced motion the field is static: stars neither move, age nor twinkle.
 *
 * It publishes nothing (no liquid surface) and knows nothing of its container. Cosmetic
 * randomness only: never the session's seeded stream.
 */
import * as THREE from "three";
import { containedContents, containedLayers } from "./contained";
import { starBrightness, starTexture } from "./star-particles";

export type ContainedStarsConfig = {
  /** How many stars live at once. */
  count: number;
  /** Seconds a star lives. */
  life: number;
  /** A star's size, as a fraction of the interior's width. */
  size: number;
  /** Its own drift speed, in interior widths per second. */
  drift: number;
  /** World-down pull, in interior widths per second per second: weak, so they don't pile up. */
  gravity: number;
  /** Its colour over its life, first to last (hex), interpolated in order. */
  ramp: readonly number[];
};

/** The colour at `fraction` (0 to 1) along an ordered ramp of colours. */
export function rampColour(
  ramp: readonly THREE.Color[],
  fraction: number,
  out: THREE.Color,
): THREE.Color {
  const scaled = Math.min(Math.max(fraction, 0), 1) * (ramp.length - 1);
  const low = Math.floor(scaled);
  const high = Math.min(low + 1, ramp.length - 1);
  return out.copy(ramp[low]!).lerp(ramp[high]!, scaled - low);
}

containedContents.register("stars", (boundary, raw) => {
  const config = raw as ContainedStarsConfig;
  const half = boundary.halfSize;
  const width = half * 2;
  // Keep star centres far enough in that their footprint stays inside the wall.
  const limit = half - (config.size * width) / 2;
  const count = config.count;
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const velocity = new Float32Array(count * 3);
  const ages = new Float32Array(count);
  const ramp = config.ramp.map((hex) => new THREE.Color(hex));
  const random = Math.random;
  const spawn = (i: number) => {
    for (let axis = 0; axis < 3; axis++) {
      positions[i * 3 + axis] = (random() * 2 - 1) * limit;
      velocity[i * 3 + axis] = (random() * 2 - 1) * config.drift * width;
    }
  };
  for (let i = 0; i < count; i++) {
    spawn(i);
    // Staggered ages, so the field never pulses in step.
    ages[i] = random() * config.life;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  const material = new THREE.PointsMaterial({
    size: config.size * width,
    sizeAttenuation: true,
    // The shared star texture is attached on the first frame, so building the block needs no
    // canvas (tests build every material's contents headless).
    map: null,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  // The field owns its geometry (the block's cleanup disposes extras' materials): release it with
  // the material, as the fading film releases its texture.
  material.addEventListener("dispose", () => geometry.dispose());
  const points = new THREE.Points(geometry, material);
  points.scale.setScalar(boundary.volumeScale);
  points.renderOrder = containedLayers.contentsTransparent;
  points.frustumCulled = false;
  // Attached when first drawn (the shared texture needs a canvas; building it doesn't).
  points.onBeforeRender = () => {
    if (material.map) return;
    material.map = starTexture();
    material.needsUpdate = true;
  };
  const down = new THREE.Vector3();
  const inverse = new THREE.Quaternion();
  const colour = new THREE.Color();
  return {
    meshes: [points],
    capabilities: {},
    update({ delta, rotation, reducedMotion }) {
      // World down, seen from inside the container this frame.
      down.set(0, -1, 0).applyQuaternion(inverse.copy(rotation).invert());
      const step = reducedMotion ? 0 : delta;
      for (let i = 0; i < count; i++) {
        ages[i] = ages[i]! + step;
        if (ages[i]! >= config.life) {
          ages[i] = 0;
          spawn(i);
        }
        for (let axis = 0; axis < 3; axis++) {
          const k = i * 3 + axis;
          velocity[k] = velocity[k]! + down.getComponent(axis) * config.gravity * width * step;
          let p = positions[k]! + velocity[k]! * step;
          // Damped deflection off the walls keeps every star inside.
          if (p > limit || p < -limit) {
            p = Math.max(-limit, Math.min(limit, p));
            velocity[k] = -velocity[k]! * 0.5;
          }
          positions[k] = p;
        }
        // The ramp itself darkens to black, so the shared fade runs over a longer span: it keeps
        // the bright birth and twinkle without dimming brown stars to nothing too soon.
        const brightness = starBrightness(ages[i]!, config.life * 2.2, i, reducedMotion ? 0 : 1);
        rampColour(ramp, ages[i]! / config.life, colour).multiplyScalar(brightness);
        colours[i * 3] = colour.r;
        colours[i * 3 + 1] = colour.g;
        colours[i * 3 + 2] = colour.b;
      }
      geometry.attributes.position!.needsUpdate = true;
      geometry.attributes.color!.needsUpdate = true;
    },
  };
});
