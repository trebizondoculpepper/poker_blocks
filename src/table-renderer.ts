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
import * as THREE from "three";
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

export function createTableRenderer(host: HTMLElement): TableRenderer {
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
  // The front canvas follows the back one at once, so HUD panels added later sit above the
  // back canvas, and the front canvas's z-index lifts it over them (src/style.css).
  host.append(renderer.domElement, front.domElement);

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
  const cardRoom = createCardRoom(scene, [renderer, front], backgroundLayer);
  // Something for crystal and metals to reflect: a soft studio room, prefiltered once, on the
  // front canvas, where the blocks are drawn.
  setReflectionEnvironment(
    new THREE.PMREMGenerator(front).fromScene(new RoomEnvironment(), 0.04).texture,
  );
  for (const light of handScene.children) light.layers.enable(dragLayer);
  // The board's lights light both passes.
  for (const light of scene.children) light.layers.enable(backgroundLayer);
  // The room's surfaces are also in the front pass, but only for what glass and crystal
  // refract: three.js draws them into its off-screen transmission target there, while on the
  // front canvas itself they write nothing, so the HUD below stays visible.
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.layers.isEnabled(backgroundLayer)) return;
    mesh.onBeforeRender = (drawing, _scene, _camera, _geometry, material) => {
      const intoRefraction = drawing === front && drawing.getRenderTarget() !== null;
      const visible = drawing !== front || intoRefraction;
      for (const item of [material].flat()) {
        item.colorWrite = visible;
        item.depthWrite = visible;
      }
    };
  });

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

  return {
    renderer,
    front,
    scene,
    handScene,
    setDragLayer(cube, dragging) {
      cube.traverse((object) => (dragging ? object.layers.set(dragLayer) : object.layers.set(0)));
    },
    render(boardCamera, handCamera) {
      cardRoom.followCamera(boardCamera as THREE.PerspectiveCamera);
      renderBack(boardCamera);
      // The front canvas: the board's blocks (the default layer only), then the hand over
      // them, then dragged blocks on a fresh depth buffer, so nothing can clip into them.
      front.clear();
      const layers = boardCamera.layers.mask;
      boardCamera.layers.set(0);
      // The room's layer is in the list too, for refraction only (see onBeforeRender above).
      boardCamera.layers.enable(backgroundLayer);
      front.render(scene, boardCamera);
      boardCamera.layers.mask = layers;
      front.clearDepth();
      handCamera.layers.set(0);
      front.render(handScene, handCamera);
      front.clearDepth();
      handCamera.layers.set(dragLayer);
      front.render(handScene, handCamera);
      handCamera.layers.set(0);
    },
    setShadowQuality: (quality) => cardRoom.setShadowQuality(quality),
    frame: (center, radius, delta) => cardRoom.frame(center, radius, delta),
    dispose() {
      renderer.dispose();
      front.dispose();
    },
  };
}
