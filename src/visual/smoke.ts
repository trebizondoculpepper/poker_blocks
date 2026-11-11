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
import {
  blockEffects,
  createParticles,
  swirl,
  type AppearanceEffect,
  type BlockEffectContext,
} from "./block-effects";

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

/** A smoke emitter: its own bounded pool, geometry and material. */
export function createSmoke(raw: AppearanceEffect, { random, size }: BlockEffectContext) {
  const config = raw as unknown as SmokeConfig & AppearanceEffect;
  const capacity = Math.ceil(config.frequency * config.lifetime) + 2;
  const { points, positions, sizes, alphas, commit, dispose } = createParticles(
    capacity,
    config.colour,
  );
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
        // Bounded sideways, never downward.
        const sway = (k: 0 | 1) => swirl(p.age, p.phases[k]!, p.rates[k]!);
        positions[index * 3] = p.origin.x + config.turbulence * size * sway(0);
        positions[index * 3 + 1] = p.origin.y + p.risen * size;
        positions[index * 3 + 2] = p.origin.z + config.turbulence * size * sway(1);
        sizes[index] = config.size * size * (1 + life);
        // A quick fade in, then thinning out as it spreads.
        alphas[index] = config.opacity * Math.min(1, 0.15 + life * 6) * (1 - life);
      });
      commit();
    },
    dispose,
  };
}

blockEffects.register("smoke", createSmoke);
