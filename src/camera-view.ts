import * as THREE from "three";
import { centerOfGravity, type MassCenter } from "./center-of-gravity";
import { tweenValue } from "./easing";
import { boardPitchRock, boardYawRock, rockAngle } from "./motion";
import { boardBaseFov, fovForZoom, pinchZoom, wheelZoom } from "./view-zoom";
import type { Cell } from "./traits/attachable";

type CameraMove = {
  startAt: number;
  fromDistance: number;
  toDistance: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
};

export type CameraViewService = {
  camera: THREE.PerspectiveCamera;
  handCamera: THREE.OrthographicCamera;
  pivot: THREE.Group;
  assembly: THREE.Group;
  readonly zoom: number;
  readonly handBaseY: number;
  start(): void;
  dispose(): void;
  setZoom(zoom: number): void;
  zoomWithWheel(deltaY: number, deltaMode: number): void;
  zoomWithPinch(startZoom: number, startDistance: number, distance: number): void;
  changeMotionRate(target: number): void;
  rotateBy(dx: number, dy: number): void;
  updateRotationCenter(center: Cell): void;
  structureRadius(): number;
  frameToStructure(): void;
  scheduleCameraMove(): void;
  beginShopEntrance(): void;
  finishShopEntrance(): void;
  reset(): void;
  update(time: number, delta: number): void;
};

/** Camera, hand projection, board framing, zoom, and board-view motion. */
export function createCameraViewService(options: {
  host: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  cubeSize: number;
  getCells(): readonly Cell[];
  getMassCenter(): MassCenter;
  layoutHand(): void;
  render(): void;
}): CameraViewService {
  const { host, renderer, scene, cubeSize } = options;
  const pivot = new THREE.Group();
  const assembly = new THREE.Group();
  pivot.rotation.order = "YXZ";
  pivot.add(assembly);
  scene.add(pivot);

  const camera = new THREE.PerspectiveCamera(boardBaseFov, 1, 0.1, 1000);
  camera.position.set(0, 3, 8);
  camera.lookAt(0, 0, 0);
  const handCamera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 100);
  handCamera.position.set(0, 3, 8);
  handCamera.lookAt(0, 0, 0);

  const cameraDirection = new THREE.Vector3(0, 3, 8).normalize();
  const initialCameraDistance = Math.hypot(3, 8);
  const cameraTarget = new THREE.Vector3();
  const pivotCell = new THREE.Vector3();
  let cameraDistance = initialCameraDistance;
  let cameraMove: CameraMove | null = null;
  let boardZoom = 1;
  let handBaseY = 0;
  let motionRate = 1;
  let rateFrom = motionRate;
  let rateTo = motionRate;
  let speedChangeAt = performance.now();
  let wobbleTime = 0;
  let manualYaw = 0;
  let manualPitch = 0;

  function cells(): readonly Cell[] {
    return options.getCells();
  }

  function desiredCamera(): { distance: number; target: THREE.Vector3 } {
    const blocks = cells();
    if (blocks.length === 0) {
      return { distance: minimumCameraDistance(), target: new THREE.Vector3(0, -0.5, 0) };
    }
    const min = {
      x: Math.min(...blocks.map(({ x }) => x)),
      y: Math.min(...blocks.map(({ y }) => y)),
      z: Math.min(...blocks.map(({ z }) => z)),
    };
    const max = {
      x: Math.max(...blocks.map(({ x }) => x)),
      y: Math.max(...blocks.map(({ y }) => y)),
      z: Math.max(...blocks.map(({ z }) => z)),
    };
    const center = centerOfGravity(options.getMassCenter());
    const extents = {
      x: Math.max(Math.abs(min.x - 0.5 - center.x), Math.abs(max.x + 0.5 - center.x)),
      y: Math.max(Math.abs(min.y - 0.5 - center.y), Math.abs(max.y + 0.5 - center.y)),
      z: Math.max(Math.abs(min.z - 0.5 - center.z), Math.abs(max.z + 0.5 - center.z)),
    };
    const radius = Math.hypot(extents.x, extents.y, extents.z) * cubeSize;
    // Frame against the neutral lens so placement never cancels the player's zoom.
    const verticalFov = THREE.MathUtils.degToRad(boardBaseFov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const limitingFov = Math.min(verticalFov, horizontalFov);
    return {
      distance: Math.max(minimumCameraDistance(), (radius / Math.sin(limitingFov / 2)) * 1.2),
      target: pivot.position.clone().add(new THREE.Vector3(0, -0.5, 0)),
    };
  }

  function minimumCameraDistance(): number {
    return initialCameraDistance * Math.max(1, 0.9 / camera.aspect);
  }

  function applyCamera(): void {
    camera.position.copy(cameraTarget).addScaledVector(cameraDirection, cameraDistance);
    camera.lookAt(cameraTarget);
  }

  function applyBoardWobble(): void {
    pivot.rotation.x = manualPitch + rockAngle(boardPitchRock, wobbleTime);
    pivot.rotation.y = manualYaw + rockAngle(boardYawRock, wobbleTime);
  }

  function setZoom(zoom: number): void {
    boardZoom = zoom;
    camera.fov = fovForZoom(zoom);
    camera.updateProjectionMatrix();
  }

  function frameToStructure(): void {
    const desired = desiredCamera();
    cameraDistance = desired.distance;
    cameraTarget.copy(desired.target);
    applyCamera();
  }

  function resize(): void {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    const aspect = width / height;
    const halfWidth = 3.3 * Math.max(1, aspect);
    const halfHeight = 3.3 * Math.max(1, 1 / aspect);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    handCamera.left = -halfWidth;
    handCamera.right = halfWidth;
    handCamera.top = halfHeight;
    handCamera.bottom = -halfHeight;
    handCamera.updateProjectionMatrix();
    handBaseY = -halfHeight + 0.48;
    handCamera.updateMatrixWorld();
    if (!cameraMove) {
      const desired = desiredCamera();
      cameraDistance = desired.distance;
      cameraTarget.copy(desired.target);
      applyCamera();
    }
    options.layoutHand();
    renderer.setSize(width, height);
    options.render();
  }

  const observer = new ResizeObserver(resize);
  const onOrientationChange = () => window.setTimeout(resize, 150);
  let started = false;

  return {
    camera,
    handCamera,
    pivot,
    assembly,
    get zoom() {
      return boardZoom;
    },
    get handBaseY() {
      return handBaseY;
    },
    start() {
      if (started) return;
      started = true;
      observer.observe(host);
      window.addEventListener("resize", resize);
      window.addEventListener("orientationchange", onOrientationChange);
      window.visualViewport?.addEventListener("resize", resize);
      resize();
    },
    dispose() {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", onOrientationChange);
      window.visualViewport?.removeEventListener("resize", resize);
    },
    setZoom(zoom) {
      setZoom(zoom);
    },
    zoomWithWheel(deltaY, deltaMode) {
      setZoom(wheelZoom(boardZoom, deltaY, deltaMode));
    },
    zoomWithPinch(startZoom, startDistance, distance) {
      setZoom(pinchZoom(startZoom, startDistance, distance));
    },
    changeMotionRate(target) {
      const now = performance.now();
      motionRate = tweenValue(rateFrom, rateTo, (now - speedChangeAt) / 1000, 0.5);
      rateFrom = motionRate;
      rateTo = target;
      speedChangeAt = now;
    },
    rotateBy(dx, dy) {
      manualYaw += dx * 0.005;
      manualPitch += dy * 0.005;
      applyBoardWobble();
    },
    updateRotationCenter(center) {
      const next = new THREE.Vector3(
        center.x * cubeSize,
        center.y * cubeSize - 0.45,
        center.z * cubeSize,
      );
      pivot.position.add(next.clone().sub(pivotCell).applyQuaternion(pivot.quaternion));
      pivotCell.copy(next);
      assembly.position.copy(pivotCell).multiplyScalar(-1);
    },
    structureRadius() {
      const blocks = cells();
      if (blocks.length === 0) return 0.87 * cubeSize;
      const center = centerOfGravity(options.getMassCenter());
      let radius = 0;
      for (const cell of blocks) {
        const distance = Math.hypot(cell.x - center.x, cell.y - center.y, cell.z - center.z);
        radius = Math.max(radius, distance);
      }
      return (radius + 0.87) * cubeSize;
    },
    frameToStructure() {
      frameToStructure();
    },
    scheduleCameraMove() {
      const desired = desiredCamera();
      cameraMove = {
        startAt: performance.now() + 1000,
        fromDistance: cameraDistance,
        toDistance: desired.distance,
        fromTarget: cameraTarget.clone(),
        toTarget: desired.target,
      };
    },
    beginShopEntrance() {
      const desired = desiredCamera();
      cameraTarget.copy(desired.target).add(new THREE.Vector3(0, 2.3, 0));
      cameraDistance = desired.distance * 1.22;
      applyCamera();
      cameraMove = {
        startAt: performance.now() - 300,
        fromDistance: cameraDistance,
        toDistance: desired.distance,
        fromTarget: cameraTarget.clone(),
        toTarget: desired.target,
      };
    },
    finishShopEntrance() {
      if (!cameraMove) return;
      const desired = desiredCamera();
      cameraMove = null;
      cameraDistance = desired.distance;
      cameraTarget.copy(desired.target);
      applyCamera();
    },
    reset() {
      pivotCell.set(0, 0, 0);
      pivot.position.set(0, 0, 0);
      assembly.position.set(0, 0, 0);
      manualYaw = 0;
      manualPitch = 0;
      cameraMove = null;
      frameToStructure();
    },
    update(time, delta) {
      motionRate = tweenValue(rateFrom, rateTo, (time - speedChangeAt) / 1000, 0.5);
      wobbleTime += motionRate * delta;
      applyBoardWobble();
      if (!cameraMove || time < cameraMove.startAt) return;
      const elapsed = (time - cameraMove.startAt) / 1000;
      cameraDistance = tweenValue(cameraMove.fromDistance, cameraMove.toDistance, elapsed, 2);
      const progress = tweenValue(0, 1, elapsed, 2);
      cameraTarget.lerpVectors(cameraMove.fromTarget, cameraMove.toTarget, progress);
      applyCamera();
      if (progress === 1) cameraMove = null;
    },
  };
}
