/**
 * devPreviewRotation (#746; doc/presentation-contracts.md, "Object browser manual rotation"): a
 * developer controller that owns a preview's pose. It starts on the automatic turntable; the
 * first drag pauses that **before** turning anything, and the pose a drag leaves is kept. A drag
 * turns the object about the camera's own axes (yaw about up, pitch about right), unclamped, so
 * every face can be reached. **Auto rotate** resumes the turntable from the current pose;
 * **Reset view** restores the three-quarter pose in manual mode. A cancelled drag keeps the pose.
 *
 * The pose belongs to the controller, not to an object, so switching entries keeps the view.
 * The handlers are plain functions over that state, testable without a browser; `mount` attaches
 * them to a preview element with use-gesture.
 */
import * as THREE from "three";
import { Gesture } from "@use-gesture/vanilla";

export type PreviewRotationConfig = {
  /** Radians per CSS pixel dragged. */
  sensitivity: number;
  /** Turntable speed, radians per second, about the vertical axis. */
  turntable: number;
  /** Radians per arrow-key press. */
  keyStep: number;
};

export const previewRotationDefaults: PreviewRotationConfig = {
  sensitivity: 0.01,
  turntable: 0.6,
  keyStep: 0.15,
};

/** The documented three-quarter view: tipped towards the camera and turned to show two sides. */
export const threeQuarterPose = (): THREE.Quaternion =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, -Math.PI / 4, 0, "YXZ"));

const worldUp = new THREE.Vector3(0, 1, 0);

export function createPreviewRotation(
  config: Partial<PreviewRotationConfig> = {},
  sounds: { turn?: () => void; click?: () => void } = {},
  /** The camera viewing the preview: a drag turns about its own up and right (#838 review). */
  camera: THREE.Camera = new THREE.Camera(),
) {
  const { sensitivity, turntable, keyStep } = { ...previewRotationDefaults, ...config };
  const pose = threeQuarterPose();
  let auto = true;
  const turn = new THREE.Quaternion();

  const up = new THREE.Vector3();
  const right = new THREE.Vector3();
  const facing = new THREE.Quaternion();

  /** Turn about the camera's own axes: yaw about its up, pitch about its right. */
  function rotateBy(yaw: number, pitch: number): void {
    camera.getWorldQuaternion(facing);
    up.set(0, 1, 0).applyQuaternion(facing);
    right.set(1, 0, 0).applyQuaternion(facing);
    pose.premultiply(turn.setFromAxisAngle(up, yaw));
    pose.premultiply(turn.setFromAxisAngle(right, pitch));
    pose.normalize();
  }

  /** The turntable spins about the vertical, as a turntable does. */
  function spinBy(angle: number): void {
    pose.premultiply(turn.setFromAxisAngle(worldUp, angle)).normalize();
  }

  return {
    pose,
    get auto() {
      return auto;
    },
    /** Each frame: advance the turntable if it runs, then give `object` the pose. */
    update(seconds: number, object: THREE.Object3D | null): void {
      if (auto) spinBy(turntable * seconds);
      object?.quaternion.copy(pose);
    },
    onDrag({ first, delta: [dx, dy] }: { first?: boolean; delta: [number, number] }): void {
      if (first) {
        // Manual from the first movement: the turntable stops before the pose changes.
        auto = false;
        sounds.turn?.();
      }
      rotateBy(dx * sensitivity, dy * sensitivity);
    },
    onKey(key: string): boolean {
      const step: Record<string, [number, number]> = {
        ArrowLeft: [-keyStep, 0],
        ArrowRight: [keyStep, 0],
        ArrowUp: [0, -keyStep],
        ArrowDown: [0, keyStep],
      };
      const [yaw, pitch] = step[key] ?? [];
      if (yaw === undefined || pitch === undefined) return false;
      auto = false;
      rotateBy(yaw, pitch);
      return true;
    },
    autoRotate(): void {
      sounds.click?.();
      auto = true;
    },
    reset(): void {
      sounds.click?.();
      auto = false;
      pose.copy(threeQuarterPose());
    },
    /** Attach drag and keys to the preview; returns a function that detaches them. */
    mount(element: HTMLElement): () => void {
      // Only the preview takes over touch; the page scrolls everywhere else.
      element.style.touchAction = "none";
      element.tabIndex = 0;
      const gesture = new Gesture(
        element,
        { onDrag: (state) => this.onDrag(state) },
        {
          drag: { pointer: { capture: true } },
        },
      );
      const keys = (event: KeyboardEvent) => {
        if (this.onKey(event.key)) event.preventDefault();
      };
      element.addEventListener("keydown", keys);
      return () => {
        gesture.destroy();
        element.removeEventListener("keydown", keys);
      };
    },
  };
}
