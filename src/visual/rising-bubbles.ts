/**
 * Rising bubbles (#353): an inclusion suspended in a liquid. It reads only the contents'
 * published `volume` (#1230: bounds, surface and world-up rise), so it knows nothing of water,
 * heat, its container or whether it has one, and ordinary water simply omits it. Hot water uses slow bubbles; boiling water (#354) uses the same
 * handler with faster, busier configuration.
 *
 * - A fixed pool. A bubble is born at a random wet point inside the interior, rises along the
 *   volume's rise direction (straight up in the world, which under nonuniform scale is not the
 *   surface's normal) at its own speed with a little wobble, and is retired the moment it reaches
 *   the current surface or rises out through the bounds; a dormant bubble waits for a wet place to
 *   be reborn. Walls hold its sway in, with a margin for its size, and it is born only where it fits.
 * - Drawn as soft round points of constant world size under any camera.
 * - Under reduced motion the bubbles hold still.
 *
 * Cosmetic randomness only: never the session's seeded stream.
 */
import * as THREE from "three";
import { cosmeticRandom } from "./block-effects";
import { containedInclusions, containedLayers, type InclusionHandler } from "./contained";
import type { ParameterSchema } from "../parameter-schema";
import { tunableEffects } from "./tunable-effects";
import { keepWorldSize } from "./world-sized-points";

export type RisingBubblesConfig = {
  /** How many bubbles at most. */
  count: number;
  /** Rise speed, in interior widths per second (each bubble varies ±40%). */
  rise: number;
  /** Sideways wobble, in interior widths. */
  wobble: number;
  /**
   * Bubbles born a second across the pool (#1232): independent of `count`, which only caps how
   * many are alive at once. Left out, each bubble is simply reborn after its own rest (Hot and
   * Boiling Water). 0 emits none, and the inclusion builds nothing.
   */
  frequency?: number;
  /** A bubble's size at birth, as a fraction of the interior's width. */
  size: number;
  /**
   * Its size on reaching the surface (#1232): it grows (or shrinks) with its share of the ascent
   * from where it was born. Left out, it keeps `size`.
   */
  endSize?: number;
  /** Seconds a bubble waits, on average, before it is born again. */
  rest: number;
  /** Its colour (hex) and opacity. */
  colour: number;
  opacity: number;
};

let disc: THREE.DataTexture | null = null;

/** A soft ring with a bright rim: a bubble seen through water. Built without a canvas. */
export function bubbleTexture(): THREE.DataTexture {
  if (disc) return disc;
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
      const alpha = r > 1 ? 0 : 0.25 + 0.75 * Math.pow(r, 4) * Math.min(1, (1 - r) * 8);
      data.set([255, 255, 255, Math.round(alpha * 255)], (y * n + x) * 4);
    }
  disc = new THREE.DataTexture(data, n, n);
  disc.magFilter = THREE.LinearFilter;
  disc.minFilter = THREE.LinearFilter;
  disc.needsUpdate = true;
  // Shared by every bubble: never freed with one block's resources (#653 review).
  disc.userData.shared = true;
  return disc;
}

export const risingBubbles: InclusionHandler = {
  requires: "volume",
  build(boundary, { volume, interior }, raw) {
    const config = raw as RisingBubblesConfig;
    // Emitting none, it is nothing at all: no pool, no geometry, no update (#1232).
    const rate = config.frequency ?? Number.POSITIVE_INFINITY;
    // A whole number of bubbles: a tuned or imported fractional pool is rounded down (#1304 review).
    const count = Math.max(0, Math.floor(config.count));
    if (!(rate > 0) || count < 1) return { meshes: [] };
    const endSize = config.endSize ?? config.size;
    // The walls keep room for the largest a bubble gets.
    const largest = Math.max(config.size, endSize);
    // The published volume (#1230): its bounds, surface and world-up rise, whoever publishes it.
    const { bounds, rise, surface } = volume!;
    const width = boundary.halfSize * 2;
    // Local (points) space to block-local space, where the volume is published.
    const toBlock = boundary.volumeScale;
    // Where a bubble's centre may be: the bounds, in points space, less its own extent.
    // The sprite keeps a world size (`keepWorldSize`: its size times the points' world y scale), so
    // under a nonuniform or turned block its local extent differs per axis: a world sphere of that
    // radius, carried back into points space, reaches `radius × |row i of the inverse|` along axis i.
    const limit = new THREE.Vector3();
    const floor = new THREE.Vector3();
    const margin = new THREE.Vector3();
    const linear = new THREE.Matrix3();
    let fits = false;
    const fit = (toWorld: THREE.Matrix4) => {
      linear.setFromMatrix4(toWorld).multiplyScalar(toBlock);
      const e = linear.elements;
      // The world radius: half the world size, as keepWorldSize scales it (column y's length).
      const radius = ((largest * width) / 2) * Math.hypot(e[3]!, e[4]!, e[5]!);
      if (!(Math.abs(linear.determinant()) > 1e-12)) return;
      const inverse = linear.invert().elements;
      // Column-major: row i of the inverse is (e[i], e[i + 3], e[i + 6]).
      margin.set(
        radius * Math.hypot(inverse[0]!, inverse[3]!, inverse[6]!),
        radius * Math.hypot(inverse[1]!, inverse[4]!, inverse[7]!),
        radius * Math.hypot(inverse[2]!, inverse[5]!, inverse[8]!),
      );
      limit.copy(bounds.max).divideScalar(toBlock).sub(margin);
      floor.copy(bounds.min).divideScalar(toBlock).add(margin);
      fits = limit.x > floor.x && limit.y > floor.y && limit.z > floor.z;
    };
    fit(new THREE.Matrix4());
    const positions = new Float32Array(count * 3);
    const alphas = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    const phase = new Float32Array(count);
    const resting = new Float32Array(count);
    // Each bubble's ascent (#1232): how far it has risen, how far it can rise from its birth, and
    // its drawn size as a share of the largest.
    const risen = new Float32Array(count);
    const ascent = new Float32Array(count);
    const scales = new Float32Array(count).fill(config.size / largest);
    const random = cosmeticRandom;
    const probe = new THREE.Vector3();
    const block = new THREE.Vector3();
    /** How far a bubble born at `from` (points space) can rise: to the surface or the bounds. */
    const ascentFrom = (from: THREE.Vector3): number => {
      const { normal, height } = surface;
      const climb = normal.dot(rise);
      let reach = climb > 1e-6 ? (height / toBlock - normal.dot(from)) / climb : Infinity;
      for (const axis of ["x", "y", "z"] as const) {
        const step = rise[axis];
        if (Math.abs(step) > 1e-9)
          reach = Math.min(reach, ((step > 0 ? limit[axis] : floor[axis]) - from[axis]) / step);
      }
      return Math.max(reach, 1e-6);
    };
    // Births the rate allows, carried between frames and capped at the pool.
    let tokens = 0;
    const born = (i: number): boolean => {
      // A few tries for a wet place; an empty or nearly empty vessel leaves the bubble resting.
      // A bubble too big for the volume is never born.
      for (let attempt = 0; fits && attempt < 6; attempt++) {
        probe.set(
          floor.x + random() * (limit.x - floor.x),
          floor.y + random() * (limit.y - floor.y),
          floor.z + random() * (limit.z - floor.z),
        );
        if (!surface.wet(block.copy(probe).multiplyScalar(toBlock))) continue;
        positions.set([probe.x, probe.y, probe.z], i * 3);
        risen[i] = 0;
        ascent[i] = ascentFrom(probe);
        scales[i] = config.size / largest;
        speed[i] = config.rise * width * (0.6 + 0.8 * random());
        phase[i] = random() * Math.PI * 2;
        return true;
      }
      return false;
    };
    const retire = (i: number) => {
      resting[i] = config.rest * (0.5 + random());
      alphas.fill(0, i * 3, i * 3 + 3);
    };
    // Staggered first births, so they don't all start together.
    for (let i = 0; i < count; i++) resting[i] = random() * config.rest;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    // Per-bubble brightness through vertex colour: a resting bubble is black, so invisible.
    geometry.setAttribute("color", new THREE.BufferAttribute(alphas, 3));
    // Each bubble's own size, as a share of the material's (the largest).
    geometry.setAttribute("bubbleScale", new THREE.BufferAttribute(scales, 1));
    const material = new THREE.PointsMaterial({
      size: largest * width,
      sizeAttenuation: true,
      map: bubbleTexture(),
      color: config.colour,
      opacity: config.opacity,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", "attribute float bubbleScale;\nvoid main() {")
        .replace("gl_PointSize = size;", "gl_PointSize = size * bubbleScale;");
    };
    const points = new THREE.Points(geometry, material);
    points.scale.setScalar(boundary.volumeScale);
    points.renderOrder = containedLayers.contentsTransparent;
    points.frustumCulled = false;
    keepWorldSize(points, material, largest * width);
    // The liquid says how its particles show through it (#742); the bubbles never ask what it is.
    const release = interior?.include(points);
    // The bubbles own their geometry and their interior registration; both are released with their
    // material, which the block disposes.
    material.addEventListener("dispose", () => {
      release?.();
      geometry.dispose();
    });
    const up = new THREE.Vector3();
    const side = new THREE.Vector3();
    const point = new THREE.Vector3();
    const held = new THREE.Vector3();
    return {
      meshes: [points],
      update({ delta, seconds, reducedMotion, toWorld }) {
        // Where a whole bubble fits under this frame's transform.
        fit(toWorld);
        if (reducedMotion) return;
        up.copy(rise);
        // The rate's births this frame, never more than the pool holds (an unset rate is unbounded).
        const gain = rate * delta;
        tokens = Math.min(count, tokens + (gain > 0 ? gain : 0));
        for (let i = 0; i < count; i++) {
          if (resting[i]! > 0) resting[i] = resting[i]! - delta;
          if (resting[i]! > 0 || alphas[i * 3]! === 0) {
            // Dormant: born once its rest is over and the rate allows one.
            if (resting[i]! > 0 || tokens < 1) continue;
            if (born(i)) {
              tokens -= 1;
              alphas.fill(1, i * 3, i * 3 + 3);
            } else resting[i] = config.rest;
            continue;
          }
          point.fromArray(positions, i * 3).addScaledVector(up, speed[i]! * delta);
          // Its share of the ascent sets its size, clamped at the surface.
          risen[i] = risen[i]! + speed[i]! * delta;
          const progress = Math.min(1, risen[i]! / ascent[i]!);
          scales[i] = (config.size + (endSize - config.size) * progress) / largest;
          // Rising out through the volume's bounds retires it, as reaching the surface does: a
          // full volume's top touches its bounds only at its highest point.
          if (!held.copy(point).clamp(floor, limit).equals(point)) {
            retire(i);
            continue;
          }
          // A gentle sideways sway, across the rising direction; the walls hold it in.
          side.set(up.y, up.z, up.x).cross(up).normalize();
          point.addScaledVector(
            side,
            Math.cos(seconds * 3 + phase[i]!) * config.wobble * width * delta,
          );
          point.clamp(floor, limit);
          point.toArray(positions, i * 3);
          // Retired the moment it reaches the current surface.
          if (!surface.wet(block.copy(point).multiplyScalar(toBlock))) retire(i);
        }
        geometry.attributes.position!.needsUpdate = true;
        geometry.attributes.color!.needsUpdate = true;
        geometry.attributes.bubbleScale!.needsUpdate = true;
      },
    };
  },
};

containedInclusions.register("risingBubbles", risingBubbles);

const number = (
  label: string,
  path: string[],
  min: number,
  max: number,
  step = 0.01,
): ParameterSchema => ({ kind: "number", label, path, min, max, step });

/** Rising bubbles' tunable defaults (#1232): a hot-water-like pool with gentle growth. */
export const risingBubblesDefaults: Required<RisingBubblesConfig> = Object.freeze({
  count: 24,
  frequency: 6,
  rise: 0.12,
  wobble: 0.02,
  size: 0.05,
  endSize: 0.1,
  rest: 0.4,
  colour: 0xeaf6ff,
  opacity: 0.75,
});

/**
 * Its schema-owned controls (#1232; doc/optical-interiors.md, "Full-volume and pooled-bubble
 * composition"): pool, rate, sizes, motion and look, each with its units and finite range, for a
 * bench to tune and Copy Settings to export. Live particle state is never a setting.
 */
tunableEffects.register("risingBubbles", {
  defaults: risingBubblesDefaults,
  parameters: {
    count: number("Pool size (bubbles)", ["count"], 0, 96, 1),
    frequency: number("Emission (bubbles a second)", ["frequency"], 0, 60, 0.5),
    size: number("Size at birth (interior widths)", ["size"], 0.01, 0.3),
    endSize: number("Size at the surface (interior widths)", ["endSize"], 0.01, 0.3),
    rise: number("Rise (interior widths a second)", ["rise"], 0, 1.5),
    wobble: number("Wobble (interior widths)", ["wobble"], 0, 0.2, 0.005),
    rest: number("Rest between bubbles (seconds)", ["rest"], 0, 4, 0.05),
    colour: number("Colour (hex)", ["colour"], 0, 0xffffff, 1),
    opacity: number("Opacity", ["opacity"], 0, 1),
  },
});
