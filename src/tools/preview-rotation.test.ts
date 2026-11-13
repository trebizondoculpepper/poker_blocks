import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { createPreviewRotation, threeQuarterPose } from "./preview-rotation";

const angle = (a: THREE.Quaternion, b: THREE.Quaternion) => a.angleTo(b);

describe("devPreviewRotation (#746)", () => {
  it("turns on the turntable until the first drag, which stops it before turning", () => {
    const turn = vi.fn();
    const rotation = createPreviewRotation({}, { turn });
    const object = new THREE.Object3D();
    const start = rotation.pose.clone();
    rotation.update(1, object);
    expect(angle(rotation.pose, start)).toBeGreaterThan(0.1);
    expect(object.quaternion.equals(rotation.pose)).toBe(true);
    rotation.onDrag({ first: true, delta: [0, 0] });
    expect(rotation.auto).toBe(false);
    expect(turn).toHaveBeenCalledTimes(1);
    const held = rotation.pose.clone();
    rotation.update(1, object);
    expect(angle(rotation.pose, held)).toBe(0);
  });

  it("drags about both viewing axes, unclamped, and keeps the pose", () => {
    const rotation = createPreviewRotation();
    rotation.onDrag({ first: true, delta: [0, 0] });
    const start = rotation.pose.clone();
    // A long vertical drag keeps turning past the pole: every face is reachable.
    for (let step = 0; step < 200; step++) rotation.onDrag({ delta: [0, Math.PI] });
    expect(angle(rotation.pose, start)).toBeLessThan(0.01);
    rotation.onDrag({ delta: [157, 0] });
    expect(angle(rotation.pose, start)).toBeCloseTo(Math.PI / 2, 2);
  });

  it("Auto rotate resumes from the current pose; Reset view restores the three-quarter pose", () => {
    const click = vi.fn();
    const rotation = createPreviewRotation({}, { click });
    rotation.onDrag({ first: true, delta: [80, 40] });
    const dragged = rotation.pose.clone();
    rotation.autoRotate();
    expect(rotation.auto).toBe(true);
    expect(angle(rotation.pose, dragged)).toBe(0);
    rotation.reset();
    expect(rotation.auto).toBe(false);
    expect(angle(rotation.pose, threeQuarterPose())).toBeLessThan(1e-6);
    expect(click).toHaveBeenCalledTimes(2);
  });

  it("arrow keys turn it too, and other keys are left alone", () => {
    const rotation = createPreviewRotation();
    const start = rotation.pose.clone();
    expect(rotation.onKey("ArrowRight")).toBe(true);
    expect(rotation.auto).toBe(false);
    expect(angle(rotation.pose, start)).toBeGreaterThan(0);
    expect(rotation.onKey("a")).toBe(false);
  });

  it("drags about the viewing camera's own axes, and spins the turntable about the vertical", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1.6, 6.2);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const rotation = createPreviewRotation({}, {}, camera);
    const axisOf = (before: THREE.Quaternion) => {
      const change = rotation.pose.clone().multiply(before.clone().invert());
      return new THREE.Vector3(change.x, change.y, change.z).normalize();
    };
    let before = rotation.pose.clone();
    rotation.onDrag({ first: true, delta: [20, 0] });
    const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    expect(axisOf(before).distanceTo(cameraUp)).toBeLessThan(1e-6);
    before = rotation.pose.clone();
    rotation.onDrag({ delta: [0, 20] });
    const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    expect(axisOf(before).distanceTo(cameraRight)).toBeLessThan(1e-6);
    rotation.autoRotate();
    before = rotation.pose.clone();
    rotation.update(0.5, null);
    expect(axisOf(before).distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-6);
  });
});
