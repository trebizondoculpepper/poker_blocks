/**
 * The particle burst exit effect (#444): a bounded number of particles launched outward from the
 * departing block, falling under gravity on parabolic paths and fading over their life. The
 * motion and resources are shared machinery; what the particles look like is configuration
 * (colour, size, and optionally the shared star artwork), so an earth spray, a star release or
 * confetti (#494) are compositions, not new code.
 *
 * - Particles are one `THREE.Points` added to the exit's root, so they share its fate: the exit
 *   owns them, and `dispose` frees their geometry and material (never the shared star texture).
 * - Gravity is world down, turned into the root's own space, so a tilted block still sprays down.
 * - The count is bounded (`maxParticles`), whatever the configuration asks.
 * - Under reduced motion it shows nothing and ends at once.
 * - Its randomness is cosmetic (`Math.random`), never the run's seeded stream. Presentation only.
 */
import * as THREE from "three";
import { exitEffects } from "./exit-presentation";
import { starTexture } from "./star-particles";
import { keepWorldSize } from "./world-sized-points";

export type BurstConfig = {
  /** How many particles (capped at `maxParticles`). */
  count?: number;
  /** Launch speed range, in block sizes per second. */
  speed?: [number, number];
  /** Extra upward bias on launch, in block sizes per second. */
  lift?: number;
  /** Downward acceleration, in block sizes per second squared. */
  gravity?: number;
  /** How long each particle lives, in seconds. */
  life?: number;
  /** Particle size, as a fraction of the block. */
  size?: number;
  /** Their colour (hex). */
  colour?: number;
  /** Draw each particle with the shared four-pointed star artwork. */
  stars?: boolean;
};

export const maxParticles = 256;
const defaults: Required<BurstConfig> = {
  count: 40,
  speed: [1.2, 2.6],
  lift: 1.2,
  gravity: 5,
  life: 0.9,
  size: 0.08,
  colour: 0xffffff,
  stars: false,
};

exitEffects.register("burst", ({ visual, reducedMotion }, raw) => {
  const config = { ...defaults, ...(raw as BurstConfig | undefined) };
  // Speeds and sizes are in block sizes: measure the block once, in its own space.
  const bounds = new THREE.Box3().setFromObject(visual.root);
  const blockSize = bounds.isEmpty()
    ? 1
    : Math.max(...bounds.getSize(new THREE.Vector3()).toArray());
  const scale = blockSize / Math.max(visual.root.getWorldScale(new THREE.Vector3()).x, 1e-6);
  const count = reducedMotion ? 0 : Math.max(0, Math.min(maxParticles, Math.round(config.count)));
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // A random direction on the unit sphere, scaled by a random speed in range.
    const z = Math.random() * 2 - 1;
    const angle = Math.random() * Math.PI * 2;
    const ring = Math.sqrt(1 - z * z);
    const speed = config.speed[0] + Math.random() * (config.speed[1] - config.speed[0]);
    velocities[i * 3] = ring * Math.cos(angle) * speed * scale;
    velocities[i * 3 + 1] = (z * speed + config.lift) * scale;
    velocities[i * 3 + 2] = ring * Math.sin(angle) * speed * scale;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: config.colour,
    size: config.size * blockSize,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  // The star artwork is shared and needs a canvas: attached when first drawn, never disposed here.
  keepWorldSize(points, material, config.size * blockSize, () => {
    if (!config.stars || material.map) return;
    material.map = starTexture();
    material.needsUpdate = true;
  });
  visual.root.add(points);
  const down = new THREE.Vector3();
  const inverse = new THREE.Quaternion();
  let age = count ? 0 : config.life;
  const finish = () => {
    age = config.life;
    material.opacity = 0;
  };
  return {
    update(delta) {
      if (age >= config.life) return false;
      const step = Math.min(delta, config.life - age);
      age += step;
      // World down, seen from the block's own space this frame.
      visual.root.getWorldQuaternion(inverse).invert();
      down.set(0, -config.gravity * scale, 0).applyQuaternion(inverse);
      for (let i = 0; i < count; i++)
        for (let axis = 0; axis < 3; axis++) {
          const k = i * 3 + axis;
          velocities[k] = velocities[k]! + down.getComponent(axis) * step;
          positions[k] = positions[k]! + velocities[k]! * step;
        }
      geometry.attributes.position!.needsUpdate = true;
      material.opacity = 1 - age / config.life;
      return age < config.life;
    },
    finish,
    dispose() {
      points.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
});
