import "./style.css";
import * as THREE from "three";
import { cardName, standardDeck, type CardBlock, type IdentityTrait } from "./cards";
import { addCell, centerOfGravity, type MassCenter } from "./center-of-gravity";
import { dealerRegistry } from "./dealer";
import { GameSession } from "./game-session";
import { tweenValue } from "./easing";
import { boardPitchRock, boardYawRock, randomRock, rockAngle, type Rock } from "./motion";
import { createMaterialise } from "./visual/materialise";
import { cellKey, faceFromNormal, faceNormal, type Cell, type Face } from "./traits/attachable";
import { toggleBlockSelection, type Selection } from "./traits/selectable";
import { inspectBlock } from "./traits/inspectable";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app element");
app.innerHTML = '<main class="scene" role="application" aria-label="Poker Blocks"></main>';

const host = app.querySelector<HTMLDivElement>(".scene")!;
const roundHud = document.createElement("aside");
roundHud.className = "round-hud";
roundHud.setAttribute("aria-label", "Round status");
roundHud.innerHTML = `
  <div class="hud-heading">ROUND</div>
  <div class="hud-row"><span>Score</span><strong data-stat="score"></strong></div>
  <div class="hud-row"><span>Target</span><strong data-stat="target"></strong></div>
  <div class="hud-divider"></div>
  <div class="hud-row"><span>Moves</span><strong data-stat="moves"></strong></div>
  <div class="hud-row"><span>Discards</span><strong data-stat="discards"></strong></div>
`;
host.append(roundHud);
const deckHud = document.createElement("aside");
deckHud.className = "deck-hud";
deckHud.innerHTML = '<span>DECK</span><strong data-stat="deck"></strong><small>cards left</small>';
host.append(deckHud);
const discardArea = document.createElement("div");
discardArea.className = "discard-area";
discardArea.setAttribute("aria-label", "Discard area");
discardArea.innerHTML = `
  <svg class="discard-icon" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges">
    <path d="M6 1h4v2H6zM3 3h10v2H3zM4 6h8v7h-1v2H5v-2H4z" />
    <path class="discard-icon-cutout" d="M6 8h1v5H6zM9 8h1v5H9z" />
  </svg>
  <span>DISCARD</span>
`;
host.append(discardArea);
const stat = (name: string) => host.querySelector<HTMLElement>(`[data-stat="${name}"]`)!;
const tooltip = document.createElement("div");
tooltip.className = "inspect-tooltip";
tooltip.setAttribute("role", "tooltip");
tooltip.hidden = true;
host.append(tooltip);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111726);
const handScene = new THREE.Scene();
const pivot = new THREE.Group();
const assembly = new THREE.Group();
pivot.rotation.order = "YXZ";
pivot.add(assembly);
scene.add(pivot);

const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 1000);
camera.position.set(0, 3, 8);
camera.lookAt(0, 0, 0);
const handCamera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 100);
handCamera.position.set(0, 3, 8);
handCamera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;
host.append(renderer.domElement);

for (const targetScene of [scene, handScene]) {
  targetScene.add(new THREE.HemisphereLight(0xffffff, 0x56627b, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-3, 6, 7);
  targetScene.add(sun);
}

function render(): void {
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(handScene, handCamera);
}

function makeFaceTexture(identity: IdentityTrait): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  context.fillStyle = "#f6f0e3";
  context.fillRect(0, 0, 512, 512);
  context.strokeStyle = "#b8b0a2";
  context.lineWidth = 12;
  context.strokeRect(26, 26, 460, 460);
  context.fillStyle = identity.suit.color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "bold 164px system-ui, sans-serif";
  context.fillText(identity.rank, 256, 205);
  context.font = "188px Georgia, serif";
  context.fillText(identity.suit.symbol, 256, 360);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

type RenderedBlock = {
  block: CardBlock;
  cube: THREE.Mesh;
  geometry: THREE.BoxGeometry;
  texture: THREE.CanvasTexture;
  material: THREE.MeshStandardMaterial;
  edgeGeometry: THREE.EdgesGeometry;
  edgeMaterial: THREE.LineBasicMaterial;
  location: "board" | "hand";
  cell: Cell | null;
  baseY: number;
  rock: Rock | null;
  handSlot: number | null;
};

const renderedBlocks: RenderedBlock[] = [];
const placed = new Map<string, RenderedBlock>();
const cubeSize = 2.4;
let massCenter: MassCenter = { count: 0, sum: { x: 0, y: 0, z: 0 } };
const pivotCell = new THREE.Vector3();

function updateRotationCenter(cell: Cell): void {
  massCenter = addCell(massCenter, cell);
  const center = centerOfGravity(massCenter);
  const next = new THREE.Vector3(
    center.x * cubeSize,
    center.y * cubeSize - 0.45,
    center.z * cubeSize,
  );
  pivot.position.add(next.clone().sub(pivotCell).applyQuaternion(pivot.quaternion));
  pivotCell.copy(next);
  assembly.position.copy(pivotCell).multiplyScalar(-1);
}
function createCube(
  block: CardBlock,
  size: number,
  location: RenderedBlock["location"],
): RenderedBlock {
  const geometry = new THREE.BoxGeometry(size, size, size);
  const texture = makeFaceTexture(block.traits.identity);
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.65 });
  const cube = new THREE.Mesh(geometry, material);
  const edgeGeometry = new THREE.EdgesGeometry(geometry);
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x6b6c73 });
  cube.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
  (location === "board" ? assembly : handScene).add(cube);
  const rendered = {
    block,
    cube,
    geometry,
    texture,
    material,
    edgeGeometry,
    edgeMaterial,
    location,
    cell: null,
    baseY: 0,
    rock: location === "hand" ? randomRock() : null,
    handSlot: null,
  } satisfies RenderedBlock;
  renderedBlocks.push(rendered);
  return rendered;
}

function disposeCube(rendered: RenderedBlock): void {
  rendered.cube.removeFromParent();
  renderedBlocks.splice(renderedBlocks.indexOf(rendered), 1);
  rendered.geometry.dispose();
  rendered.texture.dispose();
  rendered.material.dispose();
  rendered.edgeGeometry.dispose();
  rendered.edgeMaterial.dispose();
}

function addToBoard(block: CardBlock, cell: Cell): RenderedBlock {
  const rendered = createCube(block, cubeSize, "board");
  rendered.cell = cell;
  rendered.baseY = cell.y * cubeSize - 0.45;
  rendered.cube.position.set(cell.x * cubeSize, rendered.baseY, cell.z * cubeSize);
  placed.set(cellKey(cell), rendered);
  updateRotationCenter(cell);
  return rendered;
}

const cameraDirection = new THREE.Vector3(0, 3, 8).normalize();
const initialCameraDistance = Math.hypot(3, 8);
let cameraDistance = initialCameraDistance;
const cameraTarget = new THREE.Vector3();
type CameraMove = {
  startAt: number;
  fromDistance: number;
  toDistance: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
};
let cameraMove: CameraMove | null = null;

function desiredCamera(): { distance: number; target: THREE.Vector3 } {
  const cells = [...placed.values()].map(({ cell }) => cell!);
  const min = {
    x: Math.min(...cells.map(({ x }) => x)),
    y: Math.min(...cells.map(({ y }) => y)),
    z: Math.min(...cells.map(({ z }) => z)),
  };
  const max = {
    x: Math.max(...cells.map(({ x }) => x)),
    y: Math.max(...cells.map(({ y }) => y)),
    z: Math.max(...cells.map(({ z }) => z)),
  };
  const center = centerOfGravity(massCenter);
  const extents = {
    x: Math.max(Math.abs(min.x - 0.5 - center.x), Math.abs(max.x + 0.5 - center.x)),
    y: Math.max(Math.abs(min.y - 0.5 - center.y), Math.abs(max.y + 0.5 - center.y)),
    z: Math.max(Math.abs(min.z - 0.5 - center.z), Math.abs(max.z + 0.5 - center.z)),
  };
  const radius = Math.hypot(extents.x, extents.y, extents.z) * cubeSize;
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const limitingFov = Math.min(verticalFov, horizontalFov);
  return {
    distance: Math.max(initialCameraDistance, (radius / Math.sin(limitingFov / 2)) * 1.2),
    target: pivot.position.clone().add(new THREE.Vector3(0, -0.5, 0)),
  };
}

function applyCamera(): void {
  camera.position.copy(cameraTarget).addScaledVector(cameraDirection, cameraDistance);
  camera.lookAt(cameraTarget);
}

function scheduleCameraMove(): void {
  const desired = desiredCamera();
  cameraMove = {
    startAt: performance.now() + 1000,
    fromDistance: cameraDistance,
    toDistance: desired.distance,
    fromTarget: cameraTarget.clone(),
    toTarget: desired.target,
  };
}

function updateCamera(now: number): void {
  if (!cameraMove || now < cameraMove.startAt) return;
  const elapsed = (now - cameraMove.startAt) / 1000;
  cameraDistance = tweenValue(cameraMove.fromDistance, cameraMove.toDistance, elapsed, 2);
  const progress = tweenValue(0, 1, elapsed, 2);
  cameraTarget.lerpVectors(cameraMove.fromTarget, cameraMove.toTarget, progress);
  applyCamera();
  if (progress === 1) cameraMove = null;
}

const game = new GameSession(dealerRegistry, "base", standardDeck);
for (const { block, cell } of game.state.field) addToBoard(block, cell);
const handBlocks: RenderedBlock[] = game.state.hand.map((block, slot) => {
  const rendered = createCube(block, cubeSize / 3, "hand");
  rendered.handSlot = slot;
  return rendered;
});
function updateHud(): void {
  const { round, deck } = game.state;
  stat("score").textContent = String(round.score);
  stat("target").textContent = String(round.targetScore);
  stat("moves").textContent = String(round.movesLeft);
  stat("discards").textContent = String(round.discardsLeft);
  stat("deck").textContent = String(deck.length);
  discardArea.classList.toggle("is-exhausted", !game.dealer.canDiscard(game.state));
}
updateHud();

const ghostGeometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
const ghostMaterial = new THREE.MeshBasicMaterial({
  color: 0x65f4dd,
  transparent: true,
  opacity: 0.18,
  depthWrite: false,
});
const ghost = new THREE.Mesh(ghostGeometry, ghostMaterial);
ghost.visible = false;
assembly.add(ghost);
const ghostEdgeGeometry = new THREE.EdgesGeometry(ghostGeometry);
const ghostEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x65f4dd });
ghost.add(new THREE.LineSegments(ghostEdgeGeometry, ghostEdgeMaterial));

const faceGeometry = new THREE.PlaneGeometry(cubeSize * 0.94, cubeSize * 0.94);
const faceMaterial = new THREE.MeshBasicMaterial({
  color: 0x65f4dd,
  transparent: true,
  opacity: 0.28,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const faceHighlight = new THREE.Mesh(faceGeometry, faceMaterial);
faceHighlight.visible = false;
faceHighlight.renderOrder = 10;
assembly.add(faceHighlight);

let selected: Selection = new Set();
let handBaseY = 0;
type Candidate = { target: RenderedBlock; face: Face; cell: Cell };
type Drag = {
  source: RenderedBlock;
  grabOffset: THREE.Vector3;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  candidate: Candidate | null;
  discardTarget: boolean;
  lastX: number;
  lastY: number;
};
let drag: Drag | null = null;
type BoardDrag = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  active: boolean;
};
let boardDrag: BoardDrag | null = null;
let suppressClickUntil = 0;

function showInspection(block: CardBlock | undefined, clientX: number, clientY: number): void {
  const label = block && inspectBlock(block);
  if (!label) {
    tooltip.hidden = true;
    return;
  }
  tooltip.textContent = label;
  tooltip.hidden = false;
  const bounds = host.getBoundingClientRect();
  const left = clientX - bounds.left + 14;
  const top = clientY - bounds.top + 14;
  tooltip.style.left = `${Math.max(8, Math.min(left, bounds.width - tooltip.offsetWidth - 8))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(top, bounds.height - tooltip.offsetHeight - 8))}px`;
}

function showSelection(): void {
  renderedBlocks.forEach(({ block, material }) => {
    const active = selected.has(block.id);
    material.emissive.setHex(0xffffff);
    material.emissiveIntensity = active ? 0.28 : 0;
  });
  const selectedNames = renderedBlocks
    .filter(({ block }) => selected.has(block.id))
    .map(({ block }) => cardName(block.traits.identity));
  host.setAttribute(
    "aria-label",
    `${game.state.field.length} blocks in play. Hand: ${game.state.hand.map((block) => cardName(block.traits.identity)).join(", ")}. ${game.state.deck.length} in deck. Selected: ${selectedNames.join(", ") || "none"}.`,
  );
}

function layoutHand(): void {
  const visibleSlots = Math.max(
    game.dealer.handSize,
    ...handBlocks.map(({ handSlot }) => (handSlot ?? -1) + 1),
  );
  handBlocks.forEach((rendered) => {
    rendered.baseY = handBaseY;
    if (drag?.active && drag.source === rendered) return;
    rendered.cube.position.set((rendered.handSlot! - (visibleSlots - 1) / 2) * 1.2, handBaseY, 0);
  });
  showSelection();
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function pointRay(clientX: number, clientY: number, viewCamera: THREE.Camera = camera): void {
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((clientX - bounds.left) / bounds.width) * 2 - 1,
    -((clientY - bounds.top) / bounds.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, viewCamera);
}

function overDiscardArea(clientX: number, clientY: number): boolean {
  const bounds = discardArea.getBoundingClientRect();
  return (
    clientX >= bounds.left &&
    clientX <= bounds.right &&
    clientY >= bounds.top &&
    clientY <= bounds.bottom
  );
}

function pickBlock(
  clientX: number,
  clientY: number,
  candidates = renderedBlocks,
): RenderedBlock | undefined {
  pointRay(clientX, clientY, candidates === handBlocks ? handCamera : camera);
  const hit = raycaster.intersectObjects(
    candidates.map(({ cube }) => cube),
    false,
  )[0];
  return candidates.find(({ cube }) => cube === hit?.object);
}

function pickAttachment(clientX: number, clientY: number): Candidate | null {
  const boardBlocks = [...placed.values()];
  pointRay(clientX, clientY);
  const hit = raycaster.intersectObjects(
    boardBlocks.map(({ cube }) => cube),
    false,
  )[0];
  if (!hit?.face) return null;
  const target = boardBlocks.find(({ cube }) => cube === hit.object);
  if (!target?.cell) return null;
  const normal = hit.face.normal;
  const face = faceFromNormal({
    x: Math.round(normal.x),
    y: Math.round(normal.y),
    z: Math.round(normal.z),
  });
  const cell = game.dealer.placementFor(game.state, target.block.id, face);
  return cell ? { target, face, cell } : null;
}

function showCandidate(candidate: Candidate | null): void {
  ghost.visible = faceHighlight.visible = Boolean(candidate);
  if (!candidate?.target.cell) return;
  ghost.position.set(
    candidate.cell.x * cubeSize,
    candidate.cell.y * cubeSize - 0.45,
    candidate.cell.z * cubeSize,
  );
  const normal = faceNormal(candidate.face);
  faceHighlight.position.set(
    (candidate.target.cell.x + normal.x * 0.505) * cubeSize,
    (candidate.target.cell.y + normal.y * 0.505) * cubeSize - 0.45,
    (candidate.target.cell.z + normal.z * 0.505) * cubeSize,
  );
  faceHighlight.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(normal.x, normal.y, normal.z),
  );
}

function updateCandidate(): void {
  if (!drag?.active) return;
  drag.discardTarget =
    game.dealer.canDiscard(game.state) && overDiscardArea(drag.lastX, drag.lastY);
  discardArea.classList.toggle("is-target", drag.discardTarget);
  drag.candidate =
    !drag.discardTarget && game.dealer.canPlay(game.state)
      ? pickAttachment(drag.lastX, drag.lastY)
      : null;
  showCandidate(drag.candidate);
}

const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const dragPoint = new THREE.Vector3();
function moveDraggedBlock(): void {
  if (!drag?.active) return;
  pointRay(drag.lastX, drag.lastY, handCamera);
  if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
    drag.source.cube.position.copy(dragPoint).add(drag.grabOffset);
  }
}

const normalMotionRate = 1;
let motionRate = normalMotionRate;
let rateFrom = motionRate;
let rateTo = motionRate;
let speedChangeAt = performance.now();
let wobbleTime = 0;
let manualYaw = 0;
let manualPitch = 0;
function currentMotionRate(now: number): number {
  return tweenValue(rateFrom, rateTo, (now - speedChangeAt) / 1000, 0.5);
}
function changeMotionRate(target: number): void {
  const now = performance.now();
  motionRate = currentMotionRate(now);
  rateFrom = motionRate;
  rateTo = target;
  speedChangeAt = now;
}

function applyBoardWobble(): void {
  pivot.rotation.x = manualPitch + rockAngle(boardPitchRock, wobbleTime);
  pivot.rotation.y = manualYaw + rockAngle(boardYawRock, wobbleTime);
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
type MaterialiseEffect = ReturnType<typeof createMaterialise>;
const appearing: { effect: MaterialiseEffect; edges: THREE.Object3D[] }[] = [];
type PendingAction =
  | {
      kind: "play";
      source: RenderedBlock;
      slot: number;
      cell: Cell;
      startedAt: number;
      fromPosition: THREE.Vector3;
      fromRotation: THREE.Quaternion;
      fromScale: number;
    }
  | {
      kind: "discard";
      source: RenderedBlock;
      slot: number;
      startedAt: number;
      effect: MaterialiseEffect;
    };
let pendingAction: PendingAction | null = null;

function removeFromHand(source: RenderedBlock): number {
  handBlocks.splice(handBlocks.indexOf(source), 1);
  layoutHand();
  return source.handSlot!;
}

function refillSlot(slot: number): void {
  const drawn = game.refillHand();
  const replacements: RenderedBlock[] = [];
  const usedSlots = new Set(handBlocks.map(({ handSlot }) => handSlot));
  for (const block of drawn) {
    const rendered = createCube(block, cubeSize / 3, "hand");
    let nextSlot = slot;
    while (usedSlots.has(nextSlot)) nextSlot++;
    rendered.handSlot = nextSlot;
    usedSlots.add(nextSlot);
    handBlocks.push(rendered);
    replacements.push(rendered);
  }
  layoutHand();
  updateHud();
  for (const rendered of replacements) {
    const edges = [...rendered.cube.children];
    edges.forEach((edge) => (edge.visible = false));
    rendered.cube.updateWorldMatrix(true, true);
    const effect = createMaterialise(rendered.cube, { seconds: 0.9, reduced: reducedMotion });
    appearing.push({ effect, edges });
  }
}

function startPlacement(source: RenderedBlock, candidate: Candidate): boolean {
  const next = game.play({
    cardId: source.block.id,
    targetId: candidate.target.block.id,
    face: candidate.face,
  });
  if (!next) return false;
  const cell = next.field[next.field.length - 1].cell;
  const slot = removeFromHand(source);
  // The cameras use different projections. Match the hand cube's screen position and
  // apparent size in the board view, then let the assembly carry it as it wobbles.
  handCamera.updateWorldMatrix(true, false);
  camera.updateWorldMatrix(true, false);
  source.cube.updateWorldMatrix(true, false);
  const screenPosition = source.cube.getWorldPosition(new THREE.Vector3()).project(handCamera);
  const boardRay = new THREE.Raycaster();
  boardRay.setFromCamera(new THREE.Vector2(screenPosition.x, screenPosition.y), camera);
  const forward = camera.getWorldDirection(new THREE.Vector3());
  const depth =
    (handCamera.top - handCamera.bottom) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  const boardPosition = boardRay.ray.at(
    depth / boardRay.ray.direction.dot(forward),
    new THREE.Vector3(),
  );
  scene.add(source.cube);
  source.cube.position.copy(boardPosition);
  assembly.attach(source.cube);
  pendingAction = {
    kind: "play",
    source,
    slot,
    cell,
    startedAt: performance.now(),
    fromPosition: source.cube.position.clone(),
    fromRotation: source.cube.quaternion.clone(),
    fromScale: source.cube.scale.x,
  };
  updateHud();
  return true;
}

function startDiscard(source: RenderedBlock): boolean {
  if (!game.discard(source.block.id)) return false;
  const slot = removeFromHand(source);
  selected = new Set([...selected].filter((id) => id !== source.block.id));
  const edges = source.cube.children;
  edges.forEach((edge) => (edge.visible = false));
  source.cube.updateWorldMatrix(true, true);
  const effect = createMaterialise(source.cube, {
    seconds: 1,
    out: true,
    reduced: reducedMotion,
  });
  pendingAction = { kind: "discard", source, slot, startedAt: performance.now(), effect };
  updateHud();
  return true;
}

const placementTarget = new THREE.Vector3();
const placementRotation = new THREE.Quaternion();
function updateAction(now: number, delta: number): void {
  for (let index = appearing.length - 1; index >= 0; index--) {
    const { effect, edges } = appearing[index];
    if (effect.update(delta)) continue;
    edges.forEach((edge) => (edge.visible = true));
    appearing.splice(index, 1);
  }
  if (!pendingAction) return;
  const action = pendingAction;
  const elapsed = (now - action.startedAt) / 1000;
  if (action.kind === "play") {
    const progress = tweenValue(0, 1, elapsed, 1);
    placementTarget.set(
      action.cell.x * cubeSize,
      action.cell.y * cubeSize - 0.45,
      action.cell.z * cubeSize,
    );
    action.source.cube.position.lerpVectors(action.fromPosition, placementTarget, progress);
    action.source.cube.quaternion.copy(action.fromRotation).slerp(placementRotation, progress);
    action.source.cube.scale.setScalar(THREE.MathUtils.lerp(action.fromScale, 3, progress));
  } else {
    action.effect.update(delta);
  }
  if (elapsed < 1) return;
  pendingAction = null;
  if (action.kind === "play") {
    action.source.location = "board";
    action.source.cell = action.cell;
    action.source.baseY = action.cell.y * cubeSize - 0.45;
    action.source.rock = null;
    action.source.handSlot = null;
    placed.set(cellKey(action.cell), action.source);
    updateRotationCenter(action.cell);
    scheduleCameraMove();
  } else {
    disposeCube(action.source);
  }
  refillSlot(action.slot);
}

function finishDrag(drop: boolean): void {
  if (!drag) return;
  const activeDrag = drag;
  if (activeDrag.active) {
    if (drop) updateCandidate();
    const candidate = drop ? activeDrag.candidate : null;
    const discard = drop && activeDrag.discardTarget;
    drag = null;
    showCandidate(null);
    discardArea.classList.remove("is-target");
    const accepted = discard
      ? startDiscard(activeDrag.source)
      : candidate
        ? startPlacement(activeDrag.source, candidate)
        : false;
    if (!accepted) {
      handScene.add(activeDrag.source.cube);
      activeDrag.source.cube.position.z = 0;
      layoutHand();
    }
    changeMotionRate(normalMotionRate);
    suppressClickUntil = performance.now() + 250;
    if (renderer.domElement.hasPointerCapture(activeDrag.pointerId)) {
      renderer.domElement.releasePointerCapture(activeDrag.pointerId);
    }
  } else {
    drag = null;
  }
}

function finishBoardDrag(): void {
  if (!boardDrag) return;
  const finished = boardDrag;
  boardDrag = null;
  if (!finished.active) return;
  changeMotionRate(normalMotionRate);
  suppressClickUntil = performance.now() + 250;
  if (renderer.domElement.hasPointerCapture(finished.pointerId)) {
    renderer.domElement.releasePointerCapture(finished.pointerId);
  }
}

const onPointerDown = (event: PointerEvent) => {
  if (pendingAction) return;
  tooltip.hidden = true;
  const source = pickBlock(event.clientX, event.clientY, handBlocks);
  if (source?.block.traits.attachable) {
    pointRay(event.clientX, event.clientY, handCamera);
    const grabOffset = raycaster.ray.intersectPlane(dragPlane, dragPoint)
      ? source.cube.position.clone().sub(dragPoint)
      : new THREE.Vector3();
    drag = {
      source,
      grabOffset,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      active: false,
      candidate: null,
      discardTarget: false,
    };
    return;
  }
  if (!pickBlock(event.clientX, event.clientY, [...placed.values()])) return;
  boardDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    active: false,
  };
};
const onPointerMove = (event: PointerEvent) => {
  if (drag?.pointerId === event.pointerId) {
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 8) {
      drag.active = true;
      renderer.domElement.setPointerCapture(event.pointerId);
      changeMotionRate(normalMotionRate / 10);
    }
    if (drag.active) {
      tooltip.hidden = true;
      moveDraggedBlock();
      updateCandidate();
      renderer.domElement.style.cursor = "grabbing";
      return;
    }
  }
  if (boardDrag?.pointerId === event.pointerId) {
    const dx = event.clientX - boardDrag.lastX;
    const dy = event.clientY - boardDrag.lastY;
    boardDrag.lastX = event.clientX;
    boardDrag.lastY = event.clientY;
    if (
      !boardDrag.active &&
      Math.hypot(event.clientX - boardDrag.startX, event.clientY - boardDrag.startY) > 8
    ) {
      boardDrag.active = true;
      renderer.domElement.setPointerCapture(event.pointerId);
      changeMotionRate(0);
    }
    if (boardDrag.active) {
      tooltip.hidden = true;
      manualYaw += dx * 0.005;
      manualPitch += dy * 0.005;
      applyBoardWobble();
      renderer.domElement.style.cursor = "grabbing";
      return;
    }
  }
  const hovered =
    pickBlock(event.clientX, event.clientY, handBlocks) ??
    pickBlock(event.clientX, event.clientY, [...placed.values()]);
  renderer.domElement.style.cursor = hovered?.block.traits.selectable ? "pointer" : "default";
  showInspection(
    event.pointerType === "touch" ? undefined : hovered?.block,
    event.clientX,
    event.clientY,
  );
};
const onPointerLeave = () => {
  tooltip.hidden = true;
  renderer.domElement.style.cursor = "default";
};
const onPointerUp = (event: PointerEvent) => {
  const wasDragging = Boolean(drag?.active || boardDrag?.active);
  if (drag?.pointerId === event.pointerId) {
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    moveDraggedBlock();
    finishDrag(true);
  }
  if (boardDrag?.pointerId === event.pointerId) finishBoardDrag();
  renderer.domElement.style.cursor = "default";
  const hovered =
    pickBlock(event.clientX, event.clientY, handBlocks) ??
    pickBlock(event.clientX, event.clientY, [...placed.values()]);
  showInspection(
    wasDragging || event.pointerType === "touch" ? undefined : hovered?.block,
    event.clientX,
    event.clientY,
  );
};
const onPointerCancel = (event: PointerEvent) => {
  if (drag?.pointerId === event.pointerId) finishDrag(false);
  if (boardDrag?.pointerId === event.pointerId) finishBoardDrag();
  tooltip.hidden = true;
  renderer.domElement.style.cursor = "default";
};
const onClick = (event: MouseEvent) => {
  if (performance.now() < suppressClickUntil) return;
  const target =
    pickBlock(event.clientX, event.clientY, handBlocks) ??
    pickBlock(event.clientX, event.clientY, [...placed.values()]);
  if (!target) return;
  selected = toggleBlockSelection(selected, target.block);
  showSelection();
};
renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("pointermove", onPointerMove);
renderer.domElement.addEventListener("pointerleave", onPointerLeave);
renderer.domElement.addEventListener("pointerup", onPointerUp);
renderer.domElement.addEventListener("pointercancel", onPointerCancel);
renderer.domElement.addEventListener("click", onClick);

const resize = () => {
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
  handBaseY = -halfHeight + 0.75;
  handCamera.updateMatrixWorld();
  if (!cameraMove) {
    const desired = desiredCamera();
    cameraDistance = desired.distance;
    cameraTarget.copy(desired.target);
    applyCamera();
  }
  layoutHand();
  renderer.setSize(width, height);
  render();
};
const observer = new ResizeObserver(resize);
observer.observe(host);
resize();

let frame = 0;
let lastTime = 0;
const animate = (time: number) => {
  const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
  lastTime = time;
  motionRate = currentMotionRate(time);
  wobbleTime += motionRate * delta;
  applyBoardWobble();
  updateCamera(time);
  updateAction(time, delta);
  handBlocks.forEach(({ cube, rock }) => {
    if (!rock) return;
    cube.rotation.z = rockAngle(rock, time / 1000);
  });
  if (drag?.active) updateCandidate();
  render();
  frame = requestAnimationFrame(animate);
};
frame = requestAnimationFrame(animate);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
    renderer.domElement.removeEventListener("click", onClick);
    if (pendingAction?.kind === "discard") pendingAction.effect.finish();
    appearing.forEach(({ effect }) => effect.finish());
    renderedBlocks.slice().forEach(disposeCube);
    ghostGeometry.dispose();
    ghostMaterial.dispose();
    ghostEdgeGeometry.dispose();
    ghostEdgeMaterial.dispose();
    faceGeometry.dispose();
    faceMaterial.dispose();
    renderer.dispose();
  });
}
