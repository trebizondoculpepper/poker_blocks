/**
 * Renderer service: the WebGL renderer, the two scenes (the board in the card room, the hand
 * in a neutral studio light), the reflections crystal and metal pick up, and the frame
 * itself: the board, then the hand over it, then anything being dragged on top of both.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { setReflectionEnvironment } from "./visual/block-appearance";
import { createCardRoom, type ShadowQuality } from "./visual/card-room";

export type TableRenderer = {
  readonly renderer: THREE.WebGLRenderer;
  /** The board's scene (the card room). */
  readonly scene: THREE.Scene;
  /** The hand's scene, drawn over the board. */
  readonly handScene: THREE.Scene;
  /** Draw a cube (and its edges) above everything else while it is dragged. */
  setDragLayer(cube: THREE.Object3D, dragging: boolean): void;
  render(boardCamera: THREE.Camera, handCamera: THREE.Camera): void;
  /**
   * Draw the title's attract sequence instead of the table (#147), at quarter resolution into
   * its own canvas; CSS blurs it. Pass null to stop drawing it.
   */
  attract(scene: THREE.Scene | null, camera: THREE.Camera | null, delta: number): void;
  setShadowQuality(quality: ShadowQuality): void;
  /** Per frame: the card room's lamp follows the structure. */
  frame(center: THREE.Vector3, radius: number, delta: number): void;
  dispose(): void;
};

/** Blocks being dragged sit on this layer and are drawn last, above everything else. */
const dragLayer = 1;

export function createTableRenderer(host: HTMLElement): TableRenderer {
  // The attract sequence has its own renderer and canvas, so it can run at quarter resolution
  // without disturbing the table's drawing.
  const attractCanvas = document.createElement("canvas");
  attractCanvas.className = "attract-canvas";
  attractCanvas.setAttribute("aria-hidden", "true");
  attractCanvas.hidden = true;
  const attractRenderer = new THREE.WebGLRenderer({ canvas: attractCanvas, antialias: false });
  attractRenderer.setPixelRatio(1);
  attractRenderer.outputColorSpace = THREE.SRGBColorSpace;
  host.append(attractCanvas);

  const scene = new THREE.Scene();
  const handScene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  host.append(renderer.domElement);

  // The hand keeps its neutral studio light; the board sits in the warmer card room,
  // whose overhead lamp (see createCardRoom) adds the shadows.
  handScene.add(new THREE.HemisphereLight(0xffffff, 0x56627b, 2.4));
  const handSun = new THREE.DirectionalLight(0xffffff, 2.4);
  handSun.position.set(-3, 6, 7);
  handScene.add(handSun);
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a3226, 2));
  const boardFill = new THREE.DirectionalLight(0xffffff, 1.3);
  boardFill.position.set(-3, 6, 7);
  scene.add(boardFill);
  const cardRoom = createCardRoom(scene, renderer);
  // Something for crystal and metals to reflect: a soft studio room, prefiltered once.
  setReflectionEnvironment(
    new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture,
  );
  for (const light of handScene.children) light.layers.enable(dragLayer);

  return {
    renderer,
    scene,
    handScene,
    setDragLayer(cube, dragging) {
      cube.traverse((object) => (dragging ? object.layers.set(dragLayer) : object.layers.set(0)));
    },
    render(boardCamera, handCamera) {
      renderer.clear();
      renderer.render(scene, boardCamera);
      renderer.clearDepth();
      handCamera.layers.set(0);
      renderer.render(handScene, handCamera);
      // Dragged blocks last, on a fresh depth buffer, so nothing can clip into them.
      renderer.clearDepth();
      handCamera.layers.set(dragLayer);
      renderer.render(handScene, handCamera);
      handCamera.layers.set(0);
    },
    attract(attractScene, attractCamera, delta) {
      if (!attractScene || !attractCamera) {
        attractCanvas.hidden = true;
        return;
      }
      attractCanvas.hidden = false;
      // Quarter resolution: the blur hides the detail, and the cards are a backdrop.
      const width = Math.max(1, Math.floor((host.clientWidth || 1) / 4));
      const height = Math.max(1, Math.floor((host.clientHeight || 1) / 4));
      const size = attractRenderer.getSize(new THREE.Vector2());
      if (size.x !== width || size.y !== height) {
        attractRenderer.setSize(width, height, false);
        (attractCamera as THREE.PerspectiveCamera).aspect = width / height;
        (attractCamera as THREE.PerspectiveCamera).updateProjectionMatrix();
      }
      attractRenderer.render(attractScene, attractCamera);
      void delta;
    },
    setShadowQuality: (quality) => cardRoom.setShadowQuality(quality),
    frame: (center, radius, delta) => cardRoom.frame(center, radius, delta),
    dispose() {
      renderer.dispose();
      attractRenderer.dispose();
      attractCanvas.remove();
    },
  };
}
