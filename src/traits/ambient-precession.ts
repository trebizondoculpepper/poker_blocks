/**
 * Ambient three-axis precession (#1075; doc/result-menus.md, "Stage Won layout and reusable
 * control precession"): a control block gently turns about all three axes so its depth shows,
 * without ever spinning its text face away.
 *
 * The trait owns one dedicated transform node, inserted between the block's outer layout/spring
 * placement and its inner interaction-feedback/artwork node, and writes only that node. Its
 * orientation is the readable rest pose, then bounded oscillations about X, Y and Z in that fixed
 * order: never an accumulating drift. Phase is local ambient state advanced by the frame's own
 * `dt` (a host that stops updating it, as a covered scene does, freezes it; resuming continues
 * without catching up). Reduced motion holds the rest pose. Disposal unwraps the node.
 */
import * as THREE from "three";
import { defineTrait } from "../core/trait";
import { unitsToMs } from "../visual-events/scheduler";
import type { PresentationMount } from "./interaction-feedback";

type Triple = [number, number, number];

export const ambientPrecession = defineTrait({
  name: "ambientPrecession",
  defaults: {
    /** The readable rest pose: pitch, yaw, roll in degrees. */
    rest: [8, -12, 0] as Triple,
    /** Each axis's oscillation amplitude, degrees. */
    amplitude: [4, 6, 2] as Triple,
    /** Each axis's period in game-time units: different, so the motion never repeats quickly. */
    periodUnits: [72, 90, 108] as Triple,
    /** Each axis's phase offset, as a fraction of its period. */
    phase: [0, 0.25, 0.5] as Triple,
    reducedMotion: false,
  },
  setup({ block, settings }) {
    const node = new THREE.Group();
    node.name = "ambientPrecession";
    let inner: THREE.Object3D | null = null;
    let seconds = 0;
    const rest = new THREE.Quaternion();
    const axis = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const unit = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
    ];

    const pose = () => {
      euler.set(
        THREE.MathUtils.degToRad(settings.rest[0]),
        THREE.MathUtils.degToRad(settings.rest[1]),
        THREE.MathUtils.degToRad(settings.rest[2]),
      );
      rest.setFromEuler(euler);
      node.quaternion.copy(rest);
      if (settings.reducedMotion) return;
      for (let i = 0; i < 3; i++) {
        const period = unitsToMs(settings.periodUnits[i]!) / 1000;
        const angle =
          THREE.MathUtils.degToRad(settings.amplitude[i]!) *
          Math.sin(((seconds / period + settings.phase[i]!) % 1) * Math.PI * 2);
        node.quaternion.multiply(axis.setFromAxisAngle(unit[i]!, angle));
      }
    };

    const stopMount = block.on("presentation.mount", (payload) => {
      const target = (payload as PresentationMount).object;
      const parent = target.parent;
      if (!parent || inner === target) return;
      // Slot the node in: parent → precession → the inner node, keeping the inner's own pose.
      parent.add(node);
      node.position.copy(target.position);
      target.position.set(0, 0, 0);
      parent.remove(target);
      node.add(target);
      inner = target;
      pose();
    });

    return {
      update(dt) {
        if (!settings.reducedMotion) seconds += Math.max(0, dt);
        pose();
      },
      dispose() {
        stopMount();
        const parent = node.parent;
        if (inner && parent) {
          node.remove(inner);
          inner.position.copy(node.position);
          parent.add(inner);
        }
        node.removeFromParent();
        inner = null;
      },
    };
  },
});
