/**
 * Spring anchor: a block tied to a fixed point by a damped spring, so a kick sets it wobbling
 * and it settles back. Each axis follows the same damped oscillator,
 *
 *   acceleration = −stiffness × (position − rest) − damping × velocity,
 *
 * and its roll (rotation about the view axis) follows a second spring of the same tuning.
 * Messiness: every kick also moves where the block will come to rest, a normally distributed
 * offset from its home (`restJitter`, in units, and `tiltJitter`, in degrees, as standard
 * deviations), so it never settles quite where it started. The rest point never drifts: each new
 * one is drawn around home, not around the last.
 *
 * It owns the outer transform the scene gives it (`anchor.mount`), so it composes with
 * `interactionFeedback`, which owns the inner one. Hover and press kick it; a scene may kick it
 * too (`spring.kick`), for instance on the beat. Reduced motion holds it at home.
 */
import * as THREE from "three";
import { defineTrait } from "../core/trait";

/** A kick: velocity added along each axis (units per second) and to the roll (radians/s). */
export type SpringKick = { x?: number; y?: number; z?: number; spin?: number };

/** The outer transform a scene hands the trait to move, at its home position and roll. */
export type AnchorMount = { object: THREE.Object3D };

/** The spring's tuning and messiness, as a block's trait settings. */
export type SpringAnchorSettings = {
  /** Spring constant: higher is a faster, tighter wobble. */
  stiffness: number;
  /** Damping: higher settles sooner. Below 2 × √stiffness it overshoots and wobbles. */
  damping: number;
  /** Standard deviation of each new rest point from home, in units, across the view. */
  restJitter: number;
  /** Standard deviation of each new resting roll from home, in degrees. */
  tiltJitter: number;
  /** Upward kick when the pointer arrives. */
  hoverKick: number;
  /** Downward kick when the block is pressed. */
  pressKick: number;
  /** A sideways share of each kick, at random either way, so blocks don't all move alike. */
  scatter: number;
  reducedMotion: boolean;
};

/** A standard normal sample (Box-Muller). */
function standardNormal(random: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

/** The integration step, in seconds: small enough to stay stable for any sensible tuning. */
const step = 1 / 240;

/**
 * Advance one damped spring by `dt`, in fixed steps (semi-implicit Euler). Pure apart from the
 * vectors it updates, so it can be tested without rendering.
 */
export function advanceSpring(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  rest: THREE.Vector3,
  stiffness: number,
  damping: number,
  dt: number,
): void {
  const acceleration = new THREE.Vector3();
  for (let left = Math.min(dt, 0.25); left > 1e-9; left -= step) {
    const h = Math.min(step, left);
    acceleration
      .subVectors(position, rest)
      .multiplyScalar(-stiffness)
      .addScaledVector(velocity, -damping);
    velocity.addScaledVector(acceleration, h);
    position.addScaledVector(velocity, h);
  }
}

export function createSpringAnchor(random: () => number = Math.random) {
  return defineTrait<SpringAnchorSettings>({
    name: "springAnchor",
    defaults: {
      stiffness: 70,
      damping: 5,
      restJitter: 0.04,
      tiltJitter: 2,
      hoverKick: 0.8,
      pressKick: 1.6,
      scatter: 0.35,
      reducedMotion: false,
    },
    setup({ block, settings }) {
      let target: THREE.Object3D | undefined;
      const home = new THREE.Vector3();
      let homeRoll = 0;
      const rest = new THREE.Vector3();
      const position = new THREE.Vector3();
      const velocity = new THREE.Vector3();
      // The roll is the x of its own one-axis spring.
      const roll = new THREE.Vector3();
      const rollVelocity = new THREE.Vector3();
      const rollRest = new THREE.Vector3();

      const kick = ({ x = 0, y = 0, z = 0, spin = 0 }: SpringKick) => {
        if (!target || settings.reducedMotion) return;
        const strength = Math.hypot(x, y, z);
        const side = (random() * 2 - 1) * settings.scatter * strength;
        velocity.x += x + side;
        velocity.y += y;
        velocity.z += z;
        rollVelocity.x += spin - side;
        // Messiness: it will come to rest a little away from home this time.
        rest.set(
          home.x + standardNormal(random) * settings.restJitter,
          home.y + standardNormal(random) * settings.restJitter,
          home.z,
        );
        rollRest.x =
          homeRoll + THREE.MathUtils.degToRad(standardNormal(random) * settings.tiltJitter);
      };

      const stops = [
        block.on("anchor.mount", (payload) => {
          target = (payload as AnchorMount).object;
          home.copy(target.position);
          rest.copy(home);
          position.copy(home);
          velocity.set(0, 0, 0);
          homeRoll = target.rotation.z;
          roll.x = rollRest.x = homeRoll;
          rollVelocity.set(0, 0, 0);
        }),
        block.on("spring.kick", (payload) => kick(payload as SpringKick)),
        block.on("input.enter", () => kick({ y: settings.hoverKick })),
        block.on("input.press", () => kick({ y: -settings.pressKick })),
      ];
      return {
        update(dt) {
          if (!target) return;
          if (settings.reducedMotion) {
            target.position.copy(home);
            target.rotation.z = homeRoll;
            return;
          }
          advanceSpring(position, velocity, rest, settings.stiffness, settings.damping, dt);
          advanceSpring(roll, rollVelocity, rollRest, settings.stiffness, settings.damping, dt);
          target.position.copy(position);
          target.rotation.z = roll.x;
        },
        dispose() {
          stops.forEach((stop) => stop());
        },
      };
    },
  });
}

/** The spring anchor, with presentation randomness (it never touches the session stream). */
export const springAnchor = createSpringAnchor();
