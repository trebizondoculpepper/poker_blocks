/**
 * Part animation (#1196; doc/imported-models.md, "For moving parts"): a registered ambient
 * capability that moves one configured part of a visual (an imported model's rotor mount, or a
 * simple procedural mesh) while its housing and parent stay put. A definition names the animation
 * and configures it as data; nothing tests a node or material name to decide what moves.
 *
 * - **Configured.** `spin` takes the part's axis and pivot (in the part's parent space), its speed
 *   in revolutions a second, and a registered reduced-motion policy (`freeze` by default, or
 *   `slow`). Configuration is validated where it is bound.
 * - **Ambient, on the shared clock.** It advances by the presentation frame its host passes
 *   (`update({ delta, reducedMotion })`), never a timer or the finite scheduler queue. A covered
 *   scene's presentation clock stands still, so the part freezes with it.
 * - **Only the part.** The part turns about its pivot from the pose it had when bound; its parent's
 *   pose and everything else are untouched.
 * - **Lifecycle.** `dispose` puts the part back in that pose and unbinds, exactly once; updates after
 *   it do nothing.
 */
import * as THREE from "three";
import { Registry } from "../core/registry";

/** One frame of the shared ambient presentation clock, as the host passes it. */
export type PartFrame = { delta: number; reducedMotion: boolean };

/** A bound animation on one part. */
export type PartAnimation = { update(frame: PartFrame): void; dispose(): void };

/** A registered part animation: binds to an opaque part mount with its configuration. */
export type PartAnimationHandler = (mount: THREE.Object3D, config: unknown) => PartAnimation;
export const partAnimations = new Registry<PartAnimationHandler>("part animation");

/** How a moving part answers reduced motion: the share of its speed it keeps. */
export const partMotionPolicies = new Registry<{ speedShare: number }>("part motion policy");
partMotionPolicies.register("freeze", { speedShare: 0 });
partMotionPolicies.register("slow", { speedShare: 0.25 });

/** A definition's reference to an animation for one of its part mounts. */
export type PartAnimationReference = { animation: string; config?: unknown };

export type SpinConfig = {
  /** The axis it turns about, in its parent's space (normalized when bound). */
  axis: readonly [number, number, number];
  /** The point it turns about, in its parent's space; its own position by default. */
  pivot?: readonly [number, number, number];
  /** Revolutions a second (doc: Air's rotors start at 1). */
  revolutionsPerSecond: number;
  /** A registered reduced-motion policy (default `freeze`). */
  reducedMotion?: string;
};

const finite = (values: readonly number[]) => values.every(Number.isFinite);

partAnimations.register("spin", (mount, raw) => {
  const config = raw as SpinConfig;
  const axis = new THREE.Vector3(...(config?.axis ?? [0, 0, 0]));
  if (!finite(axis.toArray()) || axis.lengthSq() === 0)
    throw new RangeError("spin needs a finite, non-zero axis");
  if (!Number.isFinite(config.revolutionsPerSecond))
    throw new RangeError("spin needs a finite speed");
  const policy = partMotionPolicies.get(config.reducedMotion ?? "freeze");
  axis.normalize();
  // The pose it rests in, which every frame turns from and `dispose` restores.
  const restPosition = mount.position.clone();
  const restRotation = mount.quaternion.clone();
  const pivot = config.pivot ? new THREE.Vector3(...config.pivot) : restPosition.clone();
  if (!finite(pivot.toArray())) throw new RangeError("spin needs a finite pivot");
  const turn = new THREE.Quaternion();
  let angle = 0;
  let bound = true;
  const pose = () => {
    turn.setFromAxisAngle(axis, angle);
    mount.quaternion.copy(turn).multiply(restRotation);
    mount.position.copy(restPosition).sub(pivot).applyQuaternion(turn).add(pivot);
  };
  return {
    update({ delta, reducedMotion }) {
      if (!bound) return;
      const share = reducedMotion ? policy.speedShare : 1;
      angle =
        (angle + Math.max(0, delta) * config.revolutionsPerSecond * share * Math.PI * 2) %
        (Math.PI * 2);
      pose();
    },
    dispose() {
      if (!bound) return;
      bound = false;
      mount.position.copy(restPosition);
      mount.quaternion.copy(restRotation);
    },
  };
});

/** Bind a definition's part animation to its mount: the registered handler, by reference. */
export function bindPartAnimation(
  mount: THREE.Object3D,
  reference: PartAnimationReference,
): PartAnimation {
  return partAnimations.get(reference.animation)(mount, reference.config);
}
