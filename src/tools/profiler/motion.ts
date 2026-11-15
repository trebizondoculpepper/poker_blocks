/**
 * Profiling motion (#973; doc/presentation-contracts.md, "Profiler animation fidelity (#752)"):
 * registered deterministic pose drivers. Every case is sampled stationary; a case that declares a
 * motion is also sampled under that driver, as a separate row, so behaviour a turning block
 * triggers (dust, fluid slosh, settling) is measured without spinning everything.
 *
 * A driver turns the run's clock time since the start of a set into a world-space turn the runner
 * applies to every object on top of its own resting pose. Pure: the same time gives the same turn.
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

/** The standard motion (doc/presentation-contracts.md): a quarter turn, a hold, repeated. */
export const quarterTurns: MotionReference = {
  driver: "quarterTurns",
  config: { turnSeconds: 1, holdSeconds: 1 },
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

const up = new THREE.Vector3(0, 1, 0);

/**
 * A smooth quarter turn about world up over `turnSeconds`, held for `holdSeconds`, repeated:
 * each cycle starts where the last ended, so the block keeps turning the same way.
 */
profilingMotions.register("quarterTurns", {
  label: "quarter turns",
  tag: "quarter turns",
  create({ turnSeconds = 1, holdSeconds = 1 }) {
    const cycle = turnSeconds + holdSeconds;
    return (seconds, turn) => {
      const done = Math.floor(seconds / cycle);
      const into = Math.min((seconds - done * cycle) / turnSeconds, 1);
      const eased = into * into * (3 - 2 * into);
      turn.setFromAxisAngle(up, ((done + eased) * Math.PI) / 2);
    };
  },
});
