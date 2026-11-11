/**
 * Dust (#465): grains shaken loose when a block turns. See doc/game-architecture.md, "Ongoing
 * block effects".
 *
 * - **Release:** only rotation. The block's world-space angular speed ω (radians a second, any
 *   axis; turning the board counts) releases `proportionality × max(0, ω − threshold)` grains a
 *   second, fractions carried over. The first frame only records the pose.
 * - **Launch:** from one of `samples` fixed surface points, outward along the line from the
 *   block's centre through it, at `launch` block sizes a second.
 * - **Motion:** in world space, each velocity axis relaxes at `drag` a second toward
 *   (0, −terminal, 0): the launch dies away and the grain settles into a slow fall. A cheap
 *   stand-in for gravity plus air drag; no ground. Smoke's bounded swirl adds turbulence.
 * - **Bounds:** at most `max` grains; the oldest is reused. Reduced motion releases nothing.
 */
import * as THREE from "three";
import {
  blockEffects,
  createParticles,
  swirl,
  type AppearanceEffect,
  type BlockEffectContext,
} from "./block-effects";

export type DustConfig = {
  /** The dust's colour (hex). */
  colour: number;
  /** A grain's size, in block sizes. */
  size: number;
  /** A grain's opacity before it fades. */
  opacity: number;
  /** Seconds a grain lives; it fades over the last third. */
  lifetime: number;
  /** The widest sideways swirl, in block sizes. */
  turbulence: number;
  /** Angular speed (radians a second) at or below which nothing is released. */
  threshold: number;
  /** Grains a second for each radian a second above the threshold. */
  proportionality: number;
  /** Launch speed, in block sizes a second. */
  launch: number;
  /** How fast velocity settles toward the terminal fall, per second. */
  drag: number;
  /** The settled downward speed, in block sizes a second. */
  terminal: number;
  /** How many fixed points on the surface grains leave from. */
  samples: number;
  /** The most grains alive at once. */
  max: number;
};

/** A point on the surface of a unit cube centred on the origin (half-size 0.5). */
function surfacePoint(random: () => number): THREE.Vector3 {
  const axis = Math.floor(random() * 3);
  const side = random() < 0.5 ? -0.5 : 0.5;
  const point = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5);
  point.setComponent(axis, side);
  return point;
}

/** World-space angular speed between two orientations `delta` seconds apart, in rad/s. */
export function angularSpeed(from: THREE.Quaternion, to: THREE.Quaternion, delta: number): number {
  if (delta <= 0) return 0;
  const dot = Math.min(1, Math.abs(from.dot(to)));
  return (2 * Math.acos(dot)) / delta;
}

export function createDust(raw: AppearanceEffect, { random, size }: BlockEffectContext) {
  const config = raw as unknown as DustConfig & AppearanceEffect;
  const capacity = Math.max(1, Math.floor(config.max));
  const { points, positions, sizes, alphas, commit, dispose } = createParticles(
    capacity,
    config.colour,
  );
  const samples = Array.from({ length: Math.max(1, config.samples) }, () => surfacePoint(random));
  const grains = Array.from({ length: capacity }, () => ({
    age: Infinity,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    phases: [0, 0],
    rates: [0, 0],
  }));
  let owed = 0;
  let next = 0;
  let previous: THREE.Quaternion | null = null;
  const orientation = new THREE.Quaternion();
  const centre = new THREE.Vector3();
  const surface = new THREE.Vector3();
  const settled = new THREE.Vector3(0, -config.terminal * size, 0);

  return {
    object: points,
    update(delta: number, block: THREE.Object3D, reducedMotion: boolean) {
      block.getWorldQuaternion(orientation);
      const omega = previous ? angularSpeed(previous, orientation, delta) : 0;
      previous = (previous ?? new THREE.Quaternion()).copy(orientation);
      if (!reducedMotion) {
        owed += config.proportionality * Math.max(0, omega - config.threshold) * delta;
        block.getWorldPosition(centre);
        while (owed >= 1) {
          owed -= 1;
          const grain = grains[next]!;
          const sample = samples[Math.floor(random() * samples.length)]!;
          surface.copy(sample).multiplyScalar(size).applyMatrix4(block.matrixWorld);
          grain.age = 0;
          grain.position.copy(surface);
          grain.velocity
            .copy(surface)
            .sub(centre)
            .normalize()
            .multiplyScalar(config.launch * size);
          grain.phases = [random() * Math.PI * 2, random() * Math.PI * 2];
          grain.rates = [1.3 + random(), 1.7 + random()];
          next = (next + 1) % capacity;
        }
      }
      // Each velocity axis relaxes toward the settled fall.
      const keep = Math.exp(-config.drag * delta);
      grains.forEach((grain, index) => {
        grain.age += delta;
        const life = grain.age / config.lifetime;
        if (life >= 1) {
          alphas[index] = 0;
          return;
        }
        grain.velocity.sub(settled).multiplyScalar(keep).add(settled);
        grain.position.addScaledVector(grain.velocity, delta);
        const sway = config.turbulence * size;
        positions[index * 3] =
          grain.position.x + sway * swirl(grain.age, grain.phases[0]!, grain.rates[0]!);
        positions[index * 3 + 1] = grain.position.y;
        positions[index * 3 + 2] =
          grain.position.z + sway * swirl(grain.age, grain.phases[1]!, grain.rates[1]!);
        sizes[index] = config.size * size;
        // Full until the last third of its life, then fading to nothing.
        alphas[index] = config.opacity * Math.min(1, 3 * (1 - life));
      });
      commit();
    },
    dispose,
  };
}

blockEffects.register("dust", createDust);
