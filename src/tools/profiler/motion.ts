/**
 * Profiling motion (#973; doc/presentation-contracts.md, "Profiler animation fidelity (#752)"):
 * registered deterministic pose drivers. Every case is sampled stationary; a case that declares a
 * motion is also sampled under that driver, as a separate row, so behaviour a turning block
 * triggers (dust, fluid slosh, settling) is measured without spinning everything.
 *
 * A driver turns the run's clock time since the start of a set into a world-space turn the runner
 * applies to every object on top of the pose it had when the set started. Pure: the same time
 * gives the same turn, so every set replays the same motion, continuing from where the last left
 * the block rather than snapping back (a snap would read as a violent turn to dust).
 */
import * as THREE from "three";
import { Registry } from "../../core/registry";

import type { MotionReference } from "./motion-description.ts";
export type { MotionReference } from "./motion-description.ts";

export type MotionDriver = {
  label: string;
  /** How a row names this motion; none for the resting cohort, whose rows keep plain names. */
  tag?: string;
  /** Build the pose function: write the turn at `seconds` since the set started into `turn`. */
  create(
    config: Readonly<Record<string, number>>,
  ): (seconds: number, turn: THREE.Quaternion) => void;
};

export const profilingMotions = new Registry<MotionDriver>("profiling motion");

/** Every case's first cohort: at rest, its ambient animation only. */
export const stationary: MotionReference = { driver: "stationary" };

/**
 * The standard motion (doc/presentation-contracts.md): a quarter turn, a hold, repeated. It tips
 * the block about a horizontal axis, so which way is down inside it changes and gravity-driven
 * parts (a levelling fluid, settling scoops) respond, as dust does to any turn (#973 review).
 */
export const quarterTurns: MotionReference = {
  driver: "quarterTurns",
  config: { turnSeconds: 1, holdSeconds: 1, axisX: 1, axisY: 0, axisZ: 0 },
};

/** A motion as a result records it: its reference, with its driver's tag where it has one. */
export const recordedMotion = (motion: MotionReference): MotionReference => {
  const { tag } = profilingMotions.get(motion.driver);
  return tag ? { ...motion, tag } : { ...motion };
};

profilingMotions.register("stationary", {
  label: "stationary",
  // No tag: a stationary row is named as every row was before motion (#973).
  create: () => (_seconds, turn) => void turn.identity(),
});

/**
 * A smooth quarter turn about a world axis (`axisX/Y/Z`, horizontal by default) over
 * `turnSeconds`, held for `holdSeconds`, repeated: each cycle starts where the last ended, so the
 * block keeps turning the same way.
 */
profilingMotions.register("quarterTurns", {
  label: "quarter turns",
  tag: "quarter turns",
  create({ turnSeconds = 1, holdSeconds = 1, axisX = 1, axisY = 0, axisZ = 0 }) {
    const axis = new THREE.Vector3(axisX, axisY, axisZ).normalize();
    const cycle = turnSeconds + holdSeconds;
    return (seconds, turn) => {
      const done = Math.floor(seconds / cycle);
      const into = Math.min((seconds - done * cycle) / turnSeconds, 1);
      const eased = into * into * (3 - 2 * into);
      turn.setFromAxisAngle(axis, ((done + eased) * Math.PI) / 2);
    };
  },
});
