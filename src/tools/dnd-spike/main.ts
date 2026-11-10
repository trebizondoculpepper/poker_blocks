/**
 * dnd-kit spike (#282, slice 1): can dnd-kit drive our drags when the dragged things are 3D
 * blocks in one canvas, dropped on a DOM bin and on a 3D target? Developer page at /dnd.html;
 * never part of the game. It checks:
 * - canvas draggables: each block's draggable binds to the canvas and refuses to start unless a
 *   raycast finds that block (`preventActivation`), keeping dnd-kit's activation constraints;
 * - a DOM droppable (the bin) with dnd-kit's own collision detection;
 * - a 3D droppable (the target) with a custom collision detector that raycasts;
 * - drop commits at once (model first), cancel puts the block back.
 */
import "./style.css";
import * as THREE from "three";
import {
  DragDropManager,
  Draggable,
  Droppable,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom";
import { CollisionPriority, CollisionType } from "@dnd-kit/abstract";
import { pointerIntersection } from "@dnd-kit/collision";
import { Rectangle } from "@dnd-kit/geometry";

const log = document.getElementById("log")!;
const started = performance.now();
function trace(event: string, detail = ""): void {
  const item = document.createElement("li");
  item.textContent = `+${(performance.now() - started).toFixed(1)}ms ${event}${detail ? `: ${detail}` : ""}`;
  log.prepend(item);
  (window as unknown as { spikeLog: string[] }).spikeLog.push(item.textContent);
}
(window as unknown as { spikeLog: string[] }).spikeLog = [];

// ----- A small 3D scene: three hand blocks and a target -----
const canvas = document.getElementById("scene") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d3b2c);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.set(0, 3, 12);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x334433, 2.5));
function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
resize();
window.addEventListener("resize", resize);

const target = new THREE.Mesh(
  new THREE.BoxGeometry(2.2, 2.2, 2.2),
  new THREE.MeshStandardMaterial({ color: 0x65f4dd, transparent: true, opacity: 0.25 }),
);
target.position.set(0, 1.5, 0);
scene.add(target);
const homes = [-2.5, 0, 2.5].map((x) => new THREE.Vector3(x, -2.6, 2));
const blocks = homes.map((home, index) => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.4, 1.4),
    new THREE.MeshStandardMaterial({ color: [0xf2c14e, 0xe86f6f, 0x9cc2ff][index] }),
  );
  mesh.position.copy(home);
  mesh.userData.id = `block-${index}`;
  scene.add(mesh);
  return mesh;
});

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function hit(x: number, y: number, objects: THREE.Object3D[]): THREE.Object3D | undefined {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObjects(objects, false)[0]?.object;
}

// ----- dnd-kit -----
const manager = new DragDropManager({
  // No DOM feedback plugin: our blocks are 3D, and we move them ourselves on dragmove.
  plugins: [],
  sensors: [
    PointerSensor.configure({
      activationConstraints: [new PointerActivationConstraints.Distance({ value: 8 })],
      // Every block's draggable listens on the canvas: only the block under the pointer starts.
      // Three.js raycasts hit invisible meshes too, so a binned (hidden) block is excluded.
      preventActivation: (event, source) =>
        hit(
          event.clientX,
          event.clientY,
          blocks.filter((mesh) => mesh.visible),
        )?.userData.id !== source.id,
    }),
  ],
});

for (const mesh of blocks) new Draggable({ id: mesh.userData.id, handle: canvas }, manager);

// A DOM target: our draggables have no DOM shape, so collision is by the pointer.
/** What a drop target does, carried on its droppable: the monitor dispatches, never asks which. */
interface TargetBehaviour {
  hover(on: boolean): void;
  drop(mesh: THREE.Mesh): void;
}
const behaviour = (data: unknown) => data as TargetBehaviour | undefined;
const binElement = document.getElementById("bin")!;
new Droppable(
  {
    id: "bin",
    element: binElement,
    collisionDetector: pointerIntersection,
    data: {
      hover: (on: boolean) => binElement.classList.toggle("is-target", on),
      drop: (mesh: THREE.Mesh) => (mesh.visible = false),
    } satisfies TargetBehaviour,
  },
  manager,
);
new Droppable(
  {
    id: "target",
    // The 3D target: a raycast from the pointer, never a DOM rectangle.
    collisionDetector: ({ droppable, dragOperation }) => {
      const { x, y } = dragOperation.position.current;
      return hit(x, y, [target])
        ? {
            id: droppable.id,
            value: 1,
            type: CollisionType.PointerIntersection,
            priority: CollisionPriority.High,
          }
        : null;
    },
    data: {
      hover: (on: boolean) =>
        ((target.material as THREE.MeshStandardMaterial).opacity = on ? 0.6 : 0.25),
      drop: (mesh: THREE.Mesh) => mesh.position.copy(target.position),
    } satisfies TargetBehaviour,
  },
  manager,
);

const dragged = () => blocks.find((mesh) => mesh.userData.id === manager.dragOperation.source?.id);
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -2);
const point = new THREE.Vector3();

manager.monitor.addEventListener("dragstart", ({ operation }) =>
  trace("dragstart", String(operation.source?.id)),
);
// A canvas block has no DOM element, so dnd-kit can't measure its shape, and without a shape it
// detects no collisions. Give the operation a one-pixel shape at the pointer.
function pointerShape(): void {
  const { x, y } = manager.dragOperation.position.current;
  manager.dragOperation.shape = new Rectangle(x, y, 1, 1);
}
// Where the dragged block was when the drag began: a cancel or a miss puts it back there, so a
// cancelled drag never undoes an earlier drop.
const dragStartPosition = new THREE.Vector3();
manager.monitor.addEventListener("dragstart", () => {
  pointerShape();
  const mesh = dragged();
  if (mesh) dragStartPosition.copy(mesh.position);
});
manager.monitor.addEventListener("dragmove", () => {
  pointerShape();
  const mesh = dragged();
  const { x, y } = manager.dragOperation.position.current;
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (mesh && raycaster.ray.intersectPlane(plane, point)) mesh.position.copy(point);
});
let hovered: TargetBehaviour | undefined;
manager.monitor.addEventListener("dragover", ({ operation }) => {
  trace("dragover", String(operation.target?.id ?? "none"));
  hovered?.hover(false);
  hovered = behaviour(operation.target?.data);
  hovered?.hover(true);
});
manager.monitor.addEventListener("dragend", ({ operation, canceled }) => {
  const mesh = blocks.find((block) => block.userData.id === operation.source?.id);
  trace(
    "dragend",
    `${String(operation.source?.id)} → ${canceled ? "cancelled" : String(operation.target?.id ?? "nowhere")}`,
  );
  hovered?.hover(false);
  hovered = undefined;
  if (!mesh) return;
  // Model first: the outcome is decided now; the view simply follows.
  const drop = canceled ? undefined : behaviour(operation.target?.data);
  if (drop) drop.drop(mesh);
  else mesh.position.copy(dragStartPosition);
});

function frame(): void {
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
