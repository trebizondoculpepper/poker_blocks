/**
 * Renderer service: the two scenes (the board in the card room, the hand in a neutral studio
 * light), the reflections crystal and metal pick up, and the frame itself, drawn as two layers
 * either side of the HUD (#116):
 *
 * 1. the **back canvas**: the card room and table, with the blocks' shadows on the baize;
 * 2. the HUD overlay (DOM, between the canvases);
 * 3. the **front canvas** (transparent, never takes input): the playfield blocks, then the
 *    hand over them, then anything being dragged on top of both.
 *
 * Input stays on the back canvas: the front one passes pointer events through.
 */
import { createSceneLayer } from "./scene-layer";
import * as THREE from "three";
import { boardLights, handLights } from "./visual/lighting";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { setReflectionEnvironment } from "./visual/block-appearance";
import { createCardRoom, type ShadowQuality } from "./visual/card-room";

export type TableRenderer = {
  /** The back canvas's renderer: the room and table. Input listens on its canvas. */
  readonly renderer: THREE.WebGLRenderer;
  /** The front canvas's renderer: blocks, hand and drag, over the HUD. */
  readonly front: THREE.WebGLRenderer;
  /** The board's scene (the card room). */
  readonly scene: THREE.Scene;
  /** The hand's scene, drawn over the board. */
  readonly handScene: THREE.Scene;
  /** Draw a cube (and its edges) above everything else while it is dragged. */
  setDragLayer(cube: THREE.Object3D, dragging: boolean): void;
  render(boardCamera: THREE.Camera, handCamera: THREE.Camera): void;
  /**
   * A scene composing `tableBackground` came to the front, or left (#147). The room, the table
   * and the blocks on it are drawn while any such scene is on the stack, so the title shows none
   * of it (#789).
   */
  tableEntered(entered: boolean): void;
  /**
   * A scene composing `handView` came to the front, or left (#183). The hand (and a block
   * dragged from it) is drawn while any such scene is on the stack, so the title shows none.
   */
  handEntered(entered: boolean): void;
  /** Whether any scene shows the hand right now. */
  handShown(): boolean;
  setShadowQuality(quality: ShadowQuality): void;
  /** Per frame: the card room's lamp follows the structure. */
  frame(center: THREE.Vector3, radius: number, delta: number): void;
  dispose(): void;
};

/** Blocks being dragged sit on this layer and are drawn last, above everything else. */
const dragLayer = 1;
/** The room and table: drawn on the back canvas, under the HUD. */
export const backgroundLayer = 2;

/** Stands in for a block in the back pass: casts its shadow, draws nothing itself. */
const shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

export function createTableRenderer(host: HTMLElement, backgrounds: HTMLElement): TableRenderer {
  /** How many scenes in front compose `handView`; the hand is drawn while any does. */
  let handScenes = 0;

  const scene = new THREE.Scene();
  const handScene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  const front = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  for (const layer of [renderer, front]) {
    layer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    layer.outputColorSpace = THREE.SRGBColorSpace;
    layer.autoClear = false;
  }
  front.setClearColor(0x000000, 0);
  renderer.domElement.classList.add("table-canvas", "table-canvas-back");
  front.domElement.classList.add("table-canvas", "table-canvas-front");
  front.domElement.setAttribute("aria-hidden", "true");
  // The back canvas is the `tableBackground` trait's layer (#189): in the page only while a
  // scene composing it is on the stack, so a scene without a table has no table canvas at all.
  const backLayer = createSceneLayer(
    () => backgrounds.append(renderer.domElement),
    () => renderer.domElement.remove(),
  );
  // The front canvas's z-index lifts it over the HUD panels (src/style.css).
  host.append(front.domElement);

  // The hand keeps its neutral studio light; the board sits in the warmer card room,
  // whose overhead lamp (see createCardRoom) adds the shadows.
  handScene.add(...handLights());
  scene.add(...boardLights());
  const cardRoom = createCardRoom(scene, [renderer, front], backgroundLayer);
  // Something for crystal and metals to reflect: a soft studio room, prefiltered once, on the
  // front canvas, where the blocks are drawn.
  setReflectionEnvironment(
    new THREE.PMREMGenerator(front).fromScene(new RoomEnvironment(), 0.04).texture,
  );
  for (const light of handScene.children) light.layers.enable(dragLayer);
  // The board's lights light both passes.
  for (const light of scene.children) light.layers.enable(backgroundLayer);

  /** The back pass: the room and table, with every shadow-casting block standing in. */
  function renderBack(camera: THREE.Camera): void {
    const casters: { mesh: THREE.Mesh; material: THREE.Mesh["material"] }[] = [];
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.castShadow || mesh.layers.isEnabled(backgroundLayer)) return;
      casters.push({ mesh, material: mesh.material });
      mesh.material = shadowOnly;
      mesh.layers.enable(backgroundLayer);
    });
    const layers = camera.layers.mask;
    camera.layers.set(backgroundLayer);
    renderer.clear();
    renderer.render(scene, camera);
    camera.layers.mask = layers;
    for (const { mesh, material } of casters) {
      mesh.material = material;
      mesh.layers.disable(backgroundLayer);
    }
  }

  /** The hand over the board, then dragged blocks on a fresh depth buffer, above everything. */
  function renderHand(handCamera: THREE.Camera): void {
    front.clearDepth();
    handCamera.layers.set(0);
    front.render(handScene, handCamera);
    front.clearDepth();
    handCamera.layers.set(dragLayer);
    front.render(handScene, handCamera);
    handCamera.layers.set(0);
  }

  return {
    renderer,
    front,
    scene,
    handScene,
    setDragLayer(cube, dragging) {
      cube.traverse((object) => (dragging ? object.layers.set(dragLayer) : object.layers.set(0)));
    },
    render(boardCamera, handCamera) {
      front.clear();
      // The table, and the blocks standing on it, are drawn only while a scene composing
      // `tableBackground` is on the stack (#789): a scene without the table, such as the title,
      // never renders the field, so a finished run's blocks can't show through its attract
      // sequence. The field itself is untouched; it shows again when the table does.
      if (backLayer.mounted) {
        renderBack(boardCamera);
        // The front canvas: the board's blocks (the default layer only), then the hand over
        // them, then dragged blocks on a fresh depth buffer, so nothing can clip into them.
        const layers = boardCamera.layers.mask;
        boardCamera.layers.set(0);
        const background = scene.background;
        scene.background = null;
        front.render(scene, boardCamera);
        scene.background = background;
        boardCamera.layers.mask = layers;
      }
      if (handScenes > 0) renderHand(handCamera);
    },
    tableEntered: (entered) => backLayer.entered(entered),
    handEntered(entered) {
      handScenes = Math.max(0, handScenes + (entered ? 1 : -1));
    },
    handShown: () => handScenes > 0,
    setShadowQuality: (quality) => cardRoom.setShadowQuality(quality),
    frame: (center, radius, delta) => cardRoom.frame(center, radius, delta),
    dispose() {
      renderer.dispose();
      front.dispose();
    },
  };
}
