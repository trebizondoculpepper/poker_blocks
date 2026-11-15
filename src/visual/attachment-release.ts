/**
 * Triggered attachment release (#1065; doc/line-goes-up.md, "Triggered attachment-release
 * effect"). A registered effect for any framed object hung by named attachments: it releases the
 * first attachment, swings the object down about the remaining pivot, releases that too and lets
 * the object fall (behind the table, where geometry hides it). It knows no graph or stage: a
 * controller asks for it and hears its impact cue.
 *
 * - **Shared clock.** It runs as one effect on the shared visual-event scheduler, timed in
 *   game-time units (swing 6, fall 8 by default); no timers or frame constants.
 * - **World pose kept.** It turns the object about the pivot's captured position in the object's
 *   parent space, so changing pivot never jumps; the fall continues from wherever the swing ended.
 * - **Once.** Its completion emits the configured impact cue exactly once. Cancelling settles it
 *   once, with no impact. Reduced motion skips straight to a hidden, settled picture and still
 *   emits one cue.
 */
import * as THREE from "three";
import { unitMs, visualHandlers, type EffectHandle } from "../visual-events/scheduler";

export type AttachmentReleaseConfig = {
  /** The attachment released first. */
  first?: string;
  /** The attachment it then swings about, released after the swing. */
  pivot?: string;
  /** Game-time units of the hanging swing (default 6). */
  swingUnits?: number;
  /** Game-time units of the fall (default 8). */
  fallUnits?: number;
  /** How far it swings down about the pivot, in radians (default a little past vertical). */
  swingAngle?: number;
  /** How far the swing overshoots and settles back, as a share of the angle (default 0.12). */
  overshoot?: number;
  /** How far it falls, in its parent's units (default 6). */
  fallDistance?: number;
  /** The cue its completion names (default `picture.impact`). */
  cue?: string;
};

export const attachmentReleaseDefaults: Required<AttachmentReleaseConfig> = Object.freeze({
  first: "left",
  pivot: "right",
  swingUnits: 6,
  fallUnits: 8,
  swingAngle: Math.PI / 2,
  overshoot: 0.12,
  fallDistance: 6,
  cue: "picture.impact",
});

/** What a release acts on: the object and its attachment points in its own local space. */
export type ReleaseTarget = {
  object: THREE.Object3D;
  attachments: ReadonlyMap<string, THREE.Vector3>;
};

type Running = {
  target: ReleaseTarget;
  config: Required<AttachmentReleaseConfig>;
  reducedMotion: boolean;
  impact: (cue: string) => void;
};

const requests = new Map<string, Running>();
let nextRelease = 0;

/** The swing's progress (0–1 of the angle) at `t` in 0–1: past vertical, then settling back. */
export function swingAt(t: number, overshoot: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped < 0.6) {
    // Falling under its own weight: slow off the nail, quicker toward the bottom.
    const s = clamped / 0.6;
    return (1 + overshoot) * s * s;
  }
  // Past the bottom and back: a damped settle to rest at exactly the angle.
  const s = (clamped - 0.6) / 0.4;
  return 1 + overshoot * Math.cos((Math.PI / 2) * s * 3) * (1 - s);
}

/** The fall's progress (0–1 of the distance) at `t` in 0–1: under constant acceleration. */
export const fallAt = (t: number): number => Math.min(1, Math.max(0, t)) ** 2;

visualHandlers.register("attachment.release", (payload, context): "done" | EffectHandle => {
  const id = (payload as { release: string }).release;
  const running = requests.get(id);
  requests.delete(id);
  if (!running) return "done";
  const { target, config, reducedMotion, impact } = running;
  const { object } = target;
  let settled = false;
  const finish = (withCue: boolean) => {
    if (settled) return;
    settled = true;
    object.visible = false;
    if (withCue) impact(config.cue);
  };
  if (reducedMotion) {
    finish(true);
    return "done";
  }
  // Captured as it starts: the object's pose and the pivot, in its parent's space.
  object.updateMatrix();
  const startPosition = object.position.clone();
  const startQuaternion = object.quaternion.clone();
  const local = target.attachments.get(config.pivot) ?? new THREE.Vector3();
  const pivot = local.clone().applyMatrix4(object.matrix);
  // The picture's own facing axis: it swings in its own plane.
  const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(startQuaternion).normalize();
  // Releasing the first attachment drops that side: a released left side (−x of the pivot)
  // turns positively about the facing axis, which carries it downward.
  const first = target.attachments.get(config.first) ?? new THREE.Vector3();
  const side = -(Math.sign(first.x - local.x) || -1);
  const turn = new THREE.Quaternion();
  const offset = new THREE.Vector3();
  const swingMs = config.swingUnits * unitMs;
  const fallMs = config.fallUnits * unitMs;
  const start = context.scheduledAtMs;
  let swungPosition: THREE.Vector3 | null = null;
  return {
    update(nowMs) {
      if (settled) return "finished";
      const elapsed = nowMs - start;
      if (elapsed < swingMs) {
        const angle = side * config.swingAngle * swingAt(elapsed / swingMs, config.overshoot);
        turn.setFromAxisAngle(axis, angle);
        offset.copy(startPosition).sub(pivot).applyQuaternion(turn);
        object.position.copy(pivot).add(offset);
        object.quaternion.copy(turn).multiply(startQuaternion);
        return "running";
      }
      if (!swungPosition) {
        // The pivot lets go: hold the swing's final pose and fall from there.
        turn.setFromAxisAngle(axis, side * config.swingAngle);
        offset.copy(startPosition).sub(pivot).applyQuaternion(turn);
        swungPosition = pivot.clone().add(offset);
        object.quaternion.copy(turn).multiply(startQuaternion);
      }
      const t = (elapsed - swingMs) / Math.max(fallMs, 1e-6);
      object.position.copy(swungPosition);
      object.position.y -= config.fallDistance * fallAt(t);
      if (t < 1) return "running";
      finish(true);
      return "finished";
    },
    cancel: () => finish(false),
    dispose: () => finish(false),
  };
});

/** Ask for a release of `target`; the returned description is bound to its owner's scope. */
export function requestAttachmentRelease(
  target: ReleaseTarget,
  options: {
    config?: AttachmentReleaseConfig;
    reducedMotion: boolean;
    impact: (cue: string) => void;
  },
): { handler: string; payload: { release: string }; dueUnits: number } {
  const id = `release-${++nextRelease}`;
  requests.set(id, {
    target,
    config: { ...attachmentReleaseDefaults, ...options.config },
    reducedMotion: options.reducedMotion,
    impact: options.impact,
  });
  return { handler: "attachment.release", payload: { release: id }, dueUnits: 0 };
}

/** Forget a request that was never started (its owner left first). */
export function dropAttachmentRelease(description: { payload: { release: string } }): void {
  requests.delete(description.payload.release);
}
