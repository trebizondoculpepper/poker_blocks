/**
 * Rising bubbles (#353): an inclusion suspended in a liquid. It reads only the contents'
 * published `liquidSurface`, so it knows nothing of water, heat or its container, and ordinary
 * water simply omits it. Hot water uses slow bubbles; boiling water (#354) uses the same
 * handler with faster, busier configuration.
 *
 * - A fixed pool. A bubble is born at a random wet point inside the interior, rises along the
 *   surface's normal (world up, as the liquid levels) at its own speed with a little wobble, and
 *   is retired the moment it reaches the current surface; a dormant bubble waits for a wet place
 *   to be reborn. Walls clamp it, with a margin for its size.
 * - Drawn as soft round points of constant world size under any camera.
 * - Under reduced motion the bubbles hold still.
 *
 * Cosmetic randomness only: never the session's seeded stream.
 */
import * as THREE from "three";
import { containedInclusions, containedLayers, type InclusionHandler } from "./contained";
import { keepWorldSize } from "./world-sized-points";

export type RisingBubblesConfig = {
  /** How many bubbles at most. */
  count: number;
  /** Rise speed, in interior widths per second (each bubble varies ±40%). */
  rise: number;
  /** Sideways wobble, in interior widths. */
  wobble: number;
  /** A bubble's size, as a fraction of the interior's width. */
  size: number;
  /** Seconds a bubble waits, on average, before it is born again. */
  rest: number;
  /** Its colour (hex) and opacity. */
  colour: number;
  opacity: number;
};

let disc: THREE.DataTexture | null = null;

/** A soft ring with a bright rim: a bubble seen through water. Built without a canvas. */
function bubbleTexture(): THREE.DataTexture {
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
  return disc;
}

export const risingBubbles: InclusionHandler = {
  requires: "liquidSurface",
  build(boundary, { liquidSurface }, raw) {
    const config = raw as RisingBubblesConfig;
    const surface = liquidSurface!;
    const half = boundary.halfSize;
    const width = half * 2;
    const limit = half - (config.size * width) / 2;
    // Local (points) space to block-local space, where the surface is published.
    const toBlock = boundary.volumeScale;
    const count = config.count;
    const positions = new Float32Array(count * 3);
    const alphas = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    const phase = new Float32Array(count);
    const resting = new Float32Array(count);
    const random = Math.random;
    const probe = new THREE.Vector3();
    const born = (i: number): boolean => {
      // A few tries for a wet place; an empty or nearly empty vessel leaves the bubble resting.
      for (let attempt = 0; attempt < 6; attempt++) {
        probe.set(
          (random() * 2 - 1) * limit,
          (random() * 2 - 1) * limit,
          (random() * 2 - 1) * limit,
        );
        if (!surface.wet(probe.clone().multiplyScalar(toBlock))) continue;
        positions.set([probe.x, probe.y, probe.z], i * 3);
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
    const material = new THREE.PointsMaterial({
      size: config.size * width,
      sizeAttenuation: true,
      map: bubbleTexture(),
      color: config.colour,
      opacity: config.opacity,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    // The bubbles own their geometry; it is released with their material, which the block disposes.
    material.addEventListener("dispose", () => geometry.dispose());
    const points = new THREE.Points(geometry, material);
    points.scale.setScalar(boundary.volumeScale);
    points.renderOrder = containedLayers.contentsTransparent;
    points.frustumCulled = false;
    keepWorldSize(points, material, config.size * width);
    const up = new THREE.Vector3();
    const side = new THREE.Vector3();
    const point = new THREE.Vector3();
    return {
      meshes: [points],
      update({ delta, seconds, reducedMotion }) {
        if (reducedMotion) return;
        up.copy(surface.normal);
        for (let i = 0; i < count; i++) {
          if (resting[i]! > 0) {
            resting[i] = resting[i]! - delta;
            if (resting[i]! <= 0 && !born(i)) resting[i] = config.rest;
            continue;
          }
          point.fromArray(positions, i * 3).addScaledVector(up, speed[i]! * delta);
          // A gentle sideways sway, across the rising direction.
          side.set(up.y, up.z, up.x).cross(up).normalize();
          point.addScaledVector(
            side,
            Math.cos(seconds * 3 + phase[i]!) * config.wobble * width * delta,
          );
          point.clampScalar(-limit, limit);
          point.toArray(positions, i * 3);
          // Retired the moment it reaches the current surface.
          if (!surface.wet(point.clone().multiplyScalar(toBlock))) retire(i);
          else alphas.fill(1, i * 3, i * 3 + 3);
        }
        geometry.attributes.position!.needsUpdate = true;
        geometry.attributes.color!.needsUpdate = true;
      },
    };
  },
};

containedInclusions.register("risingBubbles", risingBubbles);
