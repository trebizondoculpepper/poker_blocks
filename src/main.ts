import "./style.css";
import * as THREE from "three";
import { cardName, standardDeck, type CardBlock } from "./cards";
import { makeDevDeck, materialOf } from "./materials";
import { sampleMaterials } from "./material-sampler";
import { addCell, centerOfGravity, type MassCenter } from "./center-of-gravity";
import { dealerRegistry, roundOutcome } from "./dealer";
import { presentationOrder, type ScoredLine } from "./scoring";
import { magnitudeSfxFor } from "./score-presentation";

import { GameSession, type Phase } from "./game-session";
import {
  demoSessionConfig,
  sandboxSessionConfig,
  unlimited,
  type SessionConfig,
} from "./session-config";
import { tweenValue } from "./easing";
import {
  boardPitchRock,
  boardYawRock,
  randomRock,
  rockAngle,
  stepRock,
  type Rock,
  type RockState,
} from "./motion";
import { createMaterialise } from "./visual/materialise";
import { isTransparent } from "./traits/transparent";
import { createCardRoom } from "./visual/card-room";
import { createBlockAppearance, setReflectionEnvironment } from "./visual/block-appearance";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { cellKey, faceFromDirection, faceNormal, type Cell, type Face } from "./traits/attachable";
import { toggleBlockSelection, type Selection } from "./traits/selectable";
import { inspectBlock } from "./traits/inspectable";
import { playSfx, setSfxMuted, setSfxVolume } from "./audio/sfx";
import { createMenus } from "./menus";
import { createConsole } from "./console/console-view";
import { musicTracks } from "./audio/music-catalog";
import { createMusicController } from "./audio/music-controller";
import { createMusicPlayer } from "./audio/music-player";
import { browserStorage, loadRun, saveRun } from "./save";
import { boardBaseFov, fovForZoom, pinchZoom, wheelZoom } from "./view-zoom";
import { bindScreenshotShortcut } from "./screenshot";
import { createPassiveRack } from "./passive-rack";
import { shopPreviewState } from "./shop-stock";
import { createShopView } from "./shop-view";
import { devRooms, fieldPlacementActive, roomFor } from "./rooms";
import { passiveDefinitions, type PassiveBlock } from "./passives";
import {
  loadSettings,
  prefersReducedMotion,
  resolveShadowQuality,
  saveSettings,
  type Settings,
} from "./settings";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app element");
app.innerHTML = '<main class="scene" role="application" aria-label="Poker Blocks"></main>';

const host = app.querySelector<HTMLDivElement>(".scene")!;
const roundHud = document.createElement("aside");
roundHud.className = "round-hud";
roundHud.setAttribute("aria-label", "Round status");
roundHud.innerHTML = `
  <div class="hud-heading" data-stat="heading">ROUND</div>
  <div class="hud-row"><span>Score</span><strong data-stat="score"></strong></div>
  <div class="hud-row"><span>Target</span><strong data-stat="target"></strong></div>
  <div class="hud-divider"></div>
  <div class="hud-row"><span>Moves</span><strong data-stat="moves"></strong></div>
  <div class="hud-row"><span>Discards</span><strong data-stat="discards"></strong></div>
  <div class="hud-divider"></div>
  <div class="hud-row"><span>Coins</span><strong data-stat="coins"></strong></div>
  <button class="hud-action" type="button" data-stat="action" hidden></button>
`;
host.append(roundHud);
const deckHud = document.createElement("aside");
deckHud.className = "deck-hud";
deckHud.innerHTML = '<span>DECK</span><strong data-stat="deck"></strong><small>cards left</small>';
host.append(deckHud);
const discardArea = document.createElement("div");
discardArea.className = "discard-area";
discardArea.setAttribute("aria-label", "Discard area");
discardArea.setAttribute("role", "button");
discardArea.innerHTML = `
  <svg class="discard-icon" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges">
    <path d="M6 1h4v2H6zM3 3h10v2H3zM4 6h8v7h-1v2H5v-2H4z" />
    <path class="discard-icon-cutout" d="M6 8h1v5H6zM9 8h1v5H9z" />
  </svg>
  <svg class="sell-icon" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges">
    <path d="M5 2h6v1h2v2h1v6h-1v2h-2v1H5v-1H3v-2H2V5h1V3h2z" />
    <path class="sell-icon-mark" d="M7 4h2v1h2v2H8v1h3v4H9v1H7v-1H5V9h3V8H5V5h2z" />
  </svg>
  <span class="discard-label">DISCARD</span>
  <b class="discard-count" hidden></b>
  <i class="refused-mark" aria-hidden="true"></i>
`;
host.append(discardArea);
const discardCount = discardArea.querySelector<HTMLElement>(".discard-count")!;

/**
 * Reusable "refused target" feedback: a red X over a drop target (its `.refused-mark`),
 * shown while hovering with `is-refused` and flashed (with a shake, unless motion is
 * reduced) when a drop or click there is refused.
 */
function flashRefused(target: HTMLElement): void {
  target.classList.remove("refused-flash", "refused-shake");
  void target.offsetWidth; // restart the animation
  target.classList.add("refused-flash");
  if (!reducedMotion) target.classList.add("refused-shake");
  window.setTimeout(() => target.classList.remove("refused-flash", "refused-shake"), 700);
}
const stat = (name: string) => host.querySelector<HTMLElement>(`[data-stat="${name}"]`)!;
const tooltip = document.createElement("div");
tooltip.className = "inspect-tooltip";
tooltip.setAttribute("role", "tooltip");
tooltip.hidden = true;
host.append(tooltip);
const scene = new THREE.Scene();
const handScene = new THREE.Scene();
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

/** Blocks being dragged sit on this layer and are drawn last, above everything else. */
const dragLayer = 1;
for (const light of handScene.children) light.layers.enable(dragLayer);

function setDragLayer(cube: THREE.Object3D, dragging: boolean): void {
  cube.traverse((object) => (dragging ? object.layers.set(dragLayer) : object.layers.set(0)));
}

function render(): void {
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  handCamera.layers.set(0);
  renderer.render(handScene, handCamera);
  // Dragged blocks last, on a fresh depth buffer, so nothing can clip into them.
  renderer.clearDepth();
  handCamera.layers.set(dragLayer);
  renderer.render(handScene, handCamera);
  handCamera.layers.set(0);
}

type RenderedBlock = {
  block: CardBlock;
  cube: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  textures: THREE.CanvasTexture[];
  /** The materials in use now (hand or table). */
  materials: THREE.MeshStandardMaterial[];
  handMaterials: THREE.MeshStandardMaterial[];
  /** Glass and crystal refract on the table, so they change material when they land. */
  boardMaterials: THREE.MeshStandardMaterial[];
  /** Meshes inside the block, such as the crystal's fire. */
  extras: THREE.Mesh[];
  edgeGeometry: THREE.EdgesGeometry;
  edgeMaterial: THREE.LineBasicMaterial;
  location: "board" | "hand";
  cell: Cell | null;
  baseY: number;
  rock: Rock | null;
  handSlot: number | null;
  /** A hand block's rock as it runs, so selection can change its speed smoothly. */
  rockState?: RockState;
  /** Where the hand layout wants this cube; it glides there each frame. */
  handX?: number;
};

const renderedBlocks: RenderedBlock[] = [];
const placed = new Map<string, RenderedBlock>();
/** Selected block ids (hand and field). Declared early: the first HUD update reads it. */
let selected: Selection = new Set();
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
  const appearance = createBlockAppearance(block.traits.identity, materialOf(block), size);
  const { geometry, textures, edgeColor, edgeOpacity } = appearance;
  const handMaterials = appearance.materials;
  const boardMaterials = appearance.boardMaterials ?? handMaterials;
  const materials = location === "board" ? boardMaterials : handMaterials;
  const cube = new THREE.Mesh(geometry, materials);
  cube.castShadow = cube.receiveShadow = true;
  const edgeGeometry = new THREE.EdgesGeometry(geometry);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: edgeColor,
    transparent: edgeOpacity < 1,
    opacity: edgeOpacity,
  });
  cube.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
  const extras = appearance.extras ?? [];
  for (const extra of extras) cube.add(extra);
  (location === "board" ? assembly : handScene).add(cube);
  const rendered = {
    block,
    cube,
    geometry,
    textures,
    materials,
    handMaterials,
    boardMaterials,
    extras,
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
  rendered.textures.forEach((texture) => texture.dispose());
  new Set([...rendered.handMaterials, ...rendered.boardMaterials]).forEach((material) =>
    material.dispose(),
  );
  for (const extra of rendered.extras)
    for (const material of ([] as THREE.Material[]).concat(extra.material)) {
      // Extras may own per-face texture copies (the ice's meltwater): free those too.
      (material as THREE.MeshStandardMaterial).map?.dispose();
      material.dispose();
    }
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
let boardZoom = 1;
const cameraTarget = new THREE.Vector3();
type CameraMove = {
  startAt: number;
  fromDistance: number;
  toDistance: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
};
let cameraMove: CameraMove | null = null;

/** World-space radius of a sphere around the placed structure, centred on the pivot. */
function structureRadius(): number {
  if (placed.size === 0) return 0.87 * cubeSize;
  const center = centerOfGravity(massCenter);
  let radius = 0;
  for (const { cell } of placed.values()) {
    const d = Math.hypot(cell!.x - center.x, cell!.y - center.y, cell!.z - center.z);
    radius = Math.max(radius, d);
  }
  return (radius + 0.87) * cubeSize;
}

function desiredCamera(): { distance: number; target: THREE.Vector3 } {
  const cells = [...placed.values()].map(({ cell }) => cell!);
  if (cells.length === 0) {
    return { distance: initialCameraDistance, target: new THREE.Vector3(0, -0.5, 0) };
  }
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
  // Framing uses the neutral lens. The player's zoom stays in effect after a
  // placement or resize instead of being cancelled by an automatic camera move.
  const verticalFov = THREE.MathUtils.degToRad(boardBaseFov);
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

function applyBoardZoom(zoom: number): void {
  boardZoom = zoom;
  camera.fov = fovForZoom(zoom);
  camera.updateProjectionMatrix();
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

const storage = browserStorage();
/**
 * Rooms (?room=...) are composed from room traits; see src/rooms.ts. dev0 is the normal game
 * with a material on every card, dev1 samples materials, dev2 has the passive rack,
 * and dev3 opens the shop with five coins.
 */
const roomParams = new URLSearchParams(window.location.search);
/** This page's room: the normal game, or a dev room. Its traits say how it behaves. */
const thisRoom = roomFor(roomParams.get("room"));
const { traits: roomTraits } = thisRoom;
const restartRoom = thisRoom.dev && roomParams.get("restart") === "true";
/** The room's session rules: endless sandboxes, and the passive rack's capacity. */
const sessionConfig: SessionConfig = {
  ...(roomTraits.sandbox ? sandboxSessionConfig(demoSessionConfig) : demoSessionConfig),
  ...(roomTraits.passiveRack ? { rackCapacity: roomTraits.passiveRack.capacity } : {}),
};
const devSeedKey = "poker-blocks.dev-material-seed";
const runSaveKey = roomTraits.save.key;
const passiveRackView = roomTraits.passiveRack
  ? createPassiveRack(host, {
      capacity: roomTraits.passiveRack.capacity,
      onPickUp: (block, event) => pickUpPassive(block, event),
    })
  : null;
function newMaterialSeed(): number {
  return Math.floor(Math.random() * 4294967296);
}
function devSeed(fresh = false): number {
  try {
    const raw = storage?.getItem(devSeedKey);
    const stored = Number(raw);
    if (
      !fresh &&
      raw !== null &&
      raw !== undefined &&
      Number.isInteger(stored) &&
      stored >= 0 &&
      stored < 4294967296
    )
      return stored;
  } catch {
    // A dev run still works when browser storage is unavailable.
  }
  const seed = newMaterialSeed();
  try {
    storage?.setItem(devSeedKey, String(seed));
  } catch {
    /* Storage is optional. */
  }
  return seed;
}
/** A deck for a run in this room: plain, or with materials (fresh, or kept by seed). */
function roomDeck(newGame: boolean): readonly CardBlock[] {
  const materials = roomTraits.materialDeck;
  if (!materials) return standardDeck;
  return makeDevDeck(materials.reshuffle === "each-run" ? newMaterialSeed() : devSeed(newGame));
}
let cards: readonly CardBlock[] = roomDeck(false);
// A fresh run sits behind the title screen until the player chooses Continue or New game.
let game = new GameSession(dealerRegistry, sessionConfig, cards);
for (const { block, cell } of game.state.field) addToBoard(block, cell);
const handBlocks: RenderedBlock[] = game.state.hand.map((block, slot) => {
  const rendered = createCube(block, cubeSize / 3, "hand");
  rendered.handSlot = slot;
  return rendered;
});
const shopView = roomTraits.shop
  ? createShopView(
      host,
      passiveRackView?.element ?? null,
      (offer) =>
        offer.kind === "passive" ? game.passivePrices.buy : (sessionConfig.cardPurchasePrice ?? 1),
      (id, destination) => {
        const bought = game.buyShopOffer(id, destination);
        if (!bought) {
          playSfx("action.denied");
          return false;
        }
        if (bought.kind === "card") {
          handBlocks.push(createCube(bought.block, cubeSize / 3, "hand"));
          syncHandSlots();
        } else passiveRackView?.render(game.state.passiveRack);
        shopView?.render(game.state.shopStock ?? [], true);
        updateHud();
        autosave();
        playSfx("shop.buy");
        return true;
      },
    )
  : null;
// The score shown lags the state until the placed card lands.
let shownScore = game.state.round.score;
/** One scoring line waiting to be shown: tint its row, play its sound, add its points. */
type ScoreStep = { at: number; line: ScoredLine };
const lineStepMs = 320;
const tintSeconds = 0.6;
const tintColor = new THREE.Color(0xffd36b);
let scoreSteps: ScoreStep[] = [];
let outcomeAt: number | null = null;
type PendingAction =
  | {
      kind: "play";
      /** One flight per block played: a single block, or a line in selection order. */
      flights: Flight[];
      startedAt: number;
      /** Every running dissolve, for clean-up. */
      effects: ReturnType<typeof createMaterialise>[];
    }
  | {
      kind: "discard";
      sources: RenderedBlock[];
      startedAt: number;
      effects: ReturnType<typeof createMaterialise>[];
    };
let pendingAction: PendingAction | null = null;

/** One block flying from the hand to its cell. */
type Flight = {
  source: RenderedBlock;
  cell: Cell;
  /** Seconds after the play starts that this block sets off (a line goes one by one). */
  delay: number;
  fromPosition: THREE.Vector3;
  fromRotation: THREE.Quaternion;
  fromScale: number;
  /**
   * The table's version of the block, waiting in its cell. As the flying block lands it
   * dissolves away while this one dissolves in (transparent blocks only).
   */
  target: RenderedBlock | null;
  handedOver: boolean;
};
/** Seconds between the blocks of a line setting off. */
const lineStagger = 0.12;
const tints: { blocks: RenderedBlock[]; startedAt: number }[] = [];
const phaseNames: Record<Phase, string> = {
  "stage-1": "STAGE 1",
  "stage-2": "STAGE 2",
  boss: "BOSS STAGE",
  shop: "SHOP",
  over: "GAME OVER",
};

/** The HUD button's label for the current moment, or null when there is nothing to do. */
function nextActionLabel(outcome: ReturnType<typeof roundOutcome>): string | null {
  if (game.phase === "shop") return "Next round";
  if (game.phase === "over") return "New game";
  if (outcome === "lost") return "End game";
  // A won stage moves on from its Stage Won pop-up, not from here.
  return null;
}

function updateHud(): void {
  const { round, deck } = game.state;
  // The game state updates as soon as a placement is accepted, but the card still
  // has to land before its scoring presentation begins. Keep outcomes hidden across
  // both parts of that sequence.
  const presenting = pendingAction?.kind === "play" || scoreSteps.length > 0 || outcomeAt !== null;
  const outcome = presenting || !game.inStage ? "playing" : roundOutcome(game.state);
  const result = outcome === "won" ? " · WON" : outcome === "lost" ? " · LOST" : "";
  stat("heading").textContent = `ROUND ${game.round} · ${phaseNames[game.phase]}${result}`;
  const label = presenting ? null : nextActionLabel(outcome);
  const action = stat("action") as HTMLButtonElement;
  action.hidden = label === null;
  action.textContent = label ?? "";
  stat("score").textContent = String(shownScore);
  const count = (n: number) => (n >= unlimited / 2 ? "∞" : String(n));
  stat("target").textContent = count(round.targetScore);
  stat("moves").textContent = count(round.movesLeft);
  stat("discards").textContent = count(round.discardsLeft);
  stat("coins").textContent = String(game.state.coins);
  stat("deck").textContent = String(deck.length);
  discardArea.classList.toggle("is-exhausted", !game.dealer.canDiscard(game.state));
  updateDiscardCount();
}

/** Hand blocks currently selected, in hand order. */
function selectedHandBlocks(): RenderedBlock[] {
  return handBlocks
    .filter(({ block }) => selected.has(block.id))
    .sort((a, b) => a.handSlot! - b.handSlot!);
}

/** The bin's badge: how many selected hand blocks a click would discard. */
function updateDiscardCount(): void {
  const count =
    game.inStage && game.dealer.canDiscard(game.state) ? selectedHandBlocks().length : 0;
  discardCount.hidden = count === 0;
  discardCount.textContent = String(count);
  discardArea.classList.toggle("is-armed", count > 0);
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
const ghostEdgeMaterial = new THREE.LineBasicMaterial({
  color: 0x65f4dd,
  transparent: true,
});
ghost.add(new THREE.LineSegments(ghostEdgeGeometry, ghostEdgeMaterial));
/** Extra outlines for the rest of a line being placed (the first cell uses `ghost`). */
const lineGhosts: THREE.Mesh[] = [];
function showLineGhosts(cells: readonly Cell[]): void {
  while (lineGhosts.length < cells.length) {
    const extra = ghost.clone();
    assembly.add(extra);
    lineGhosts.push(extra);
  }
  lineGhosts.forEach((extra, index) => {
    const cell = cells[index];
    extra.visible = Boolean(cell);
    if (cell) extra.position.set(cell.x * cubeSize, cell.y * cubeSize - 0.45, cell.z * cubeSize);
  });
}
let ghostIsDropPreview = false;

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

let handBaseY = 0;
/** Where a drop would play: a face of a placed block, or the centre of an empty field. */
/** Where a drop would play: a face (or the empty centre), and the cells it would fill. */
type Candidate = { target: RenderedBlock | null; face: Face | null; cell: Cell; cells: Cell[] };
type Drag = {
  source: RenderedBlock;
  grabOffset: THREE.Vector3;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  candidate: Candidate | null;
  discardTarget: boolean;
  /** Over the bin while discarding is not allowed: the red X shows. */
  refused: boolean;
  /** Other selected hand blocks carried with the dragged one (a group discard). */
  group: RenderedBlock[];
  /** Hand position the dragged card would move to if dropped inside the hand. */
  reorderSlot: number | null;
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
const touches = new Map<number, { x: number; y: number }>();
let pinch: { zoom: number; distance: number } | null = null;

function touchSpread(): number {
  const [first, second] = [...touches.values()];
  return first && second ? Math.hypot(second.x - first.x, second.y - first.y) : 0;
}

let lastZoomSoundAt = -Infinity;
function soundZoom(): void {
  const now = performance.now();
  if (now - lastZoomSoundAt > 350) playSfx("view.zoom");
  lastZoomSoundAt = now;
}

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
  renderedBlocks.forEach(({ block, materials }) => {
    const active = Boolean(block.traits.selectable) && selected.has(block.id);
    new Set(materials).forEach((material) => {
      material.emissive.setHex(0xffffff);
      material.emissiveIntensity = active ? 0.28 : 0;
    });
  });
  const selectedNames = renderedBlocks
    .filter(({ block }) => block.traits.selectable && selected.has(block.id))
    .map(({ block }) => cardName(block.traits.identity));
  host.setAttribute(
    "aria-label",
    `${game.state.field.length} blocks in play. Hand: ${game.state.hand.map((block) => cardName(block.traits.identity)).join(", ")}. ${game.state.deck.length} in deck. Selected: ${selectedNames.join(", ") || "none"}.`,
  );
}

function handSlotX(slot: number, visibleSlots: number): number {
  return (slot - (visibleSlots - 1) / 2) * 1.2;
}

function visibleHandSlots(): number {
  return Math.max(game.dealer.handSize, ...handBlocks.map(({ handSlot }) => (handSlot ?? -1) + 1));
}

/** Lay out the hand; while a reorder is previewed, neighbours make room for the dragged card. */
function layoutHand(): void {
  const visibleSlots = visibleHandSlots();
  const preview = drag?.active && drag.reorderSlot !== null ? drag : null;
  const order = [...handBlocks].sort((a, b) => a.handSlot! - b.handSlot!);
  if (preview) {
    order.splice(order.indexOf(preview.source), 1);
    order.splice(preview.reorderSlot!, 0, preview.source);
  }
  handBlocks.forEach((rendered) => {
    rendered.baseY = handBaseY;
    const slot = preview ? order.indexOf(rendered) : rendered.handSlot!;
    const firstLayout = rendered.handX === undefined;
    rendered.handX = handSlotX(slot, visibleSlots);
    if (isDragged(rendered)) return;
    rendered.cube.position.y = handBaseY;
    rendered.cube.position.z = 0;
    if (firstLayout) rendered.cube.position.x = rendered.handX;
  });
  showSelection();
}

function isDragged(rendered: RenderedBlock): boolean {
  return Boolean(drag?.active && (drag.source === rendered || drag.group.includes(rendered)));
}

/** Ease hand cubes toward their layout positions so reordering animates. */
function glideHand(delta: number): void {
  const step = Math.min(1, delta * 14);
  for (const rendered of handBlocks) {
    if (isDragged(rendered) || rendered.handX === undefined) continue;
    rendered.cube.position.x += (rendered.handX - rendered.cube.position.x) * step;
  }
}

/** Visual hand slots always follow the hand order held in GameState. */
function syncHandSlots(): void {
  handBlocks.forEach((rendered) => (rendered.handSlot = game.state.hand.indexOf(rendered.block)));
  layoutHand();
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

// ----- Selling a passive (issue #16): drag it from the rack to the shared drop target -----

/** A passive picked up from the rack; it becomes a drag once the pointer moves a little. */
let passiveDrag: {
  block: PassiveBlock;
  pointerId: number;
  startX: number;
  startY: number;
  floating: HTMLElement | null;
} | null = null;

/** The shared lower-screen target reads Sell while a passive is dragged, else Discard. */
function showSellTarget(selling: boolean): void {
  discardArea.classList.toggle("is-sell", selling);
  discardArea.setAttribute("aria-label", selling ? "Sell area" : "Discard area");
  discardArea.querySelector(".discard-label")!.textContent = selling ? "SELL" : "DISCARD";
  if (!selling) discardArea.classList.remove("is-target", "is-refused");
}

/** Whether a dropped passive could be sold now (not once the run is over). */
const canSellPassives = () => game.phase !== "over" && !pendingAction && !game.stageRewardsPending;

function pickUpPassive(block: PassiveBlock, event: PointerEvent): void {
  // Only the primary pointer's main button picks a passive up.
  if (passiveDrag || drag || !event.isPrimary || event.button !== 0) return;
  passiveDrag = {
    block,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    floating: null,
  };
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}

function movePassive(event: PointerEvent): void {
  if (!passiveDrag || event.pointerId !== passiveDrag.pointerId) return;
  if (!passiveDrag.floating) {
    if (Math.hypot(event.clientX - passiveDrag.startX, event.clientY - passiveDrag.startY) < 6)
      return;
    // A real drag: lift the cube out of the rack and show a token under the pointer.
    const appearance =
      passiveDrag.block.traits.appearance ?? passiveDefinitions.get(passiveDrag.block.definitionId);
    const floating = document.createElement("div");
    floating.className = "passive-floating";
    floating.textContent = appearance.symbol;
    floating.style.background = appearance.palette.face;
    floating.style.color = appearance.palette.ink;
    floating.style.borderColor = appearance.palette.edge;
    document.body.append(floating);
    passiveDrag.floating = floating;
    passiveRackView?.lift(passiveDrag.block.id);
    showSellTarget(true);
    playSfx("card.pickup");
  }
  passiveDrag.floating.style.left = `${event.clientX}px`;
  passiveDrag.floating.style.top = `${event.clientY}px`;
  const over = overDiscardArea(event.clientX, event.clientY);
  const wasTarget = discardArea.classList.contains("is-target");
  discardArea.classList.toggle("is-target", over && canSellPassives());
  discardArea.classList.toggle("is-refused", over && !canSellPassives());
  if (over && canSellPassives() && !wasTarget) playSfx("discard.hover");
}

function dropPassive(event: PointerEvent, cancelled: boolean): void {
  if (!passiveDrag || event.pointerId !== passiveDrag.pointerId) return;
  const { block, floating } = passiveDrag;
  passiveDrag = null;
  if (!floating) return; // a click, not a drag: the rack's tooltip handles that
  floating.remove();
  showSellTarget(false);
  passiveRackView?.lift(null);
  if (cancelled || !overDiscardArea(event.clientX, event.clientY)) {
    playSfx("card.drag.return");
    return;
  }
  const sold = canSellPassives() ? game.sellPassive(block.id) : null;
  if (sold === null) {
    flashRefused(discardArea);
    playSfx("action.denied");
    return;
  }
  playSfx("reward.coin");
  passiveRackView?.render(game.state.passiveRack);
  updateHud();
  autosave();
}
window.addEventListener("pointermove", movePassive);
window.addEventListener("pointerup", (event) => dropPassive(event, false));
window.addEventListener("pointercancel", (event) => dropPassive(event, true));

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

function pickAttachment(clientX: number, clientY: number, count = 1): Candidate | null {
  if (placed.size === 0) {
    // The first play of a stage goes to the centre: drop anywhere above the hand.
    const bounds = host.getBoundingClientRect();
    const aboveHand = clientY < bounds.top + bounds.height * 0.72;
    const cells = game.dealer.linePlacementFor(game.state, count);
    return aboveHand && cells ? { target: null, face: null, cell: cells[0], cells } : null;
  }
  const boardBlocks = [...placed.values()];
  pointRay(clientX, clientY);
  const hit = raycaster.intersectObjects(
    boardBlocks.map(({ cube }) => cube),
    false,
  )[0];
  if (!hit?.face) return null;
  const target = boardBlocks.find(({ cube }) => cube === hit.object);
  if (!target?.cell) return null;
  // The strongest axis, so a hit on a bevel or rounded edge still picks a face.
  const face = faceFromDirection(hit.face.normal);
  // A line runs out from the face; it is refused whole if it would reach a block.
  const cells = game.dealer.linePlacementFor(game.state, count, target.block.id, face);
  return cells ? { target, face, cell: cells[0], cells } : null;
}

function showCandidate(candidate: Candidate | null): void {
  ghostIsDropPreview = Boolean(candidate);
  ghost.visible = Boolean(candidate);
  faceHighlight.visible = Boolean(candidate?.target);
  showLineGhosts(candidate?.cells.slice(1) ?? []);
  if (!candidate) return;
  ghost.position.set(
    candidate.cell.x * cubeSize,
    candidate.cell.y * cubeSize - 0.45,
    candidate.cell.z * cubeSize,
  );
  if (!candidate.target?.cell || !candidate.face) return;
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

/** Invite the first play using the same outline as a valid attachment preview. */
function updateEmptyFieldPrompt(time: number): void {
  const cell =
    fieldPlacementActive(roomTraits, game.phase) &&
    game.inStage &&
    game.state.field.length === 0 &&
    game.state.hand.length > 0 &&
    game.dealer.canPlay(game.state) &&
    roundOutcome(game.state) === "playing"
      ? game.dealer.placementFor(game.state)
      : null;
  const idle = Boolean(cell) && !drag?.active && !pendingAction;
  ghost.visible = ghostIsDropPreview || idle;
  if (!ghost.visible) return;
  if (ghostIsDropPreview) {
    ghostMaterial.opacity = 0.18;
    ghostEdgeMaterial.opacity = 1;
    return;
  }
  ghost.position.set(cell!.x * cubeSize, cell!.y * cubeSize - 0.45, cell!.z * cubeSize);
  const pulse = reducedMotion ? 0.8 : (1 + Math.cos((time * Math.PI * 2) / 1800)) / 2;
  ghostMaterial.opacity = 0.18 * pulse;
  ghostEdgeMaterial.opacity = pulse;
}

/** The hand position under the pointer, or null when the pointer is not over the hand. */
function handReorderSlot(clientX: number, clientY: number): number | null {
  const bounds = host.getBoundingClientRect();
  if (clientY < bounds.top + bounds.height * 0.72 || handBlocks.length < 2) return null;
  pointRay(clientX, clientY, handCamera);
  if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return null;
  const slot = Math.round(dragPoint.x / 1.2 + (visibleHandSlots() - 1) / 2);
  return Math.max(0, Math.min(handBlocks.length - 1, slot));
}

function updateCandidate(): void {
  if (!drag?.active) return;
  const wasDiscardTarget = drag.discardTarget;
  const previousCell = drag.candidate ? cellKey(drag.candidate.cell) : null;
  const overBin = overDiscardArea(drag.lastX, drag.lastY);
  const canDiscard = game.dealer.canDiscard(game.state);
  drag.discardTarget = canDiscard && overBin;
  drag.refused = !canDiscard && overBin;
  discardArea.classList.toggle("is-target", drag.discardTarget);
  discardArea.classList.toggle("is-refused", drag.refused);
  // A group plays as a line (one play) or is discarded; it is not reordered as one.
  const single = drag.group.length === 0;
  drag.candidate =
    fieldPlacementActive(roomTraits, game.phase) && !overBin && game.dealer.canPlay(game.state)
      ? pickAttachment(drag.lastX, drag.lastY, drag.group.length + 1)
      : null;
  showCandidate(drag.candidate);
  const previousSlot = drag.reorderSlot;
  drag.reorderSlot =
    single && !overBin && !drag.candidate ? handReorderSlot(drag.lastX, drag.lastY) : null;
  if (drag.reorderSlot !== previousSlot) layoutHand();
  if (drag.discardTarget && !wasDiscardTarget) playSfx("discard.hover");
  if (drag.candidate && cellKey(drag.candidate.cell) !== previousCell) playSfx("card.drag.snap");
}

const awayFromCamera = new THREE.Vector3();
const fanOffset = new THREE.Vector3();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const dragPoint = new THREE.Vector3();
function moveDraggedBlock(): void {
  if (!drag?.active) return;
  pointRay(drag.lastX, drag.lastY, handCamera);
  if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
    drag.source.cube.position.copy(dragPoint).add(drag.grabOffset);
    // Carried blocks trail the dragged one in a small fanned stack behind it.
    // Each is pushed a whole block further from the camera (straight back along its view,
    // so the fan on screen is unchanged) and never intersects the one in front.
    handCamera.getWorldDirection(awayFromCamera);
    drag.group.forEach((rendered, index) => {
      const step = index + 1;
      rendered.cube.position
        .copy(drag!.source.cube.position)
        .add(fanOffset.set(0.28 * step, 0.22 * step, 0))
        .addScaledVector(awayFromCamera, cubeSize * step);
    });
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

const systemMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
let settings = loadSettings(storage);
let reducedMotion = false;
const musicPlayer = createMusicPlayer(musicTracks);
const music = createMusicController(
  musicPlayer,
  musicTracks.map(({ id }) => id),
);
function applySettings(next: Settings): void {
  settings = next;
  setSfxVolume(next.volume);
  setSfxMuted(next.muted);
  // Music sits a little under the sound effects at the same volume setting.
  musicPlayer.setVolume(next.volume * 0.75);
  musicPlayer.setMuted(next.muted);
  reducedMotion = prefersReducedMotion(next.motion, systemMotionQuery.matches);
  cardRoom.setShadowQuality(resolveShadowQuality(next.shadows, coarsePointer));
}
applySettings(settings);
systemMotionQuery.addEventListener("change", () => applySettings(settings));
type MaterialiseEffect = ReturnType<typeof createMaterialise>;
/**
 * Blocks dissolving into view. `wait` holds one back (still invisible) so refills draw in
 * one after another; a sound plays as each starts.
 */
const appearing: {
  effect: MaterialiseEffect;
  edges: THREE.Object3D[];
  cube?: THREE.Object3D;
  wait?: number;
  sound?: boolean;
}[] = [];
/** Seconds between cards drawn into the hand, one after another. */
const drawStagger = 1 / 3;

/**
 * Finish at once any draw-in still running on these blocks, before another dissolve (a
 * discard or a landing) takes them over: two at once on one block would clash.
 */
function settleAppearing(blocks: readonly RenderedBlock[]): void {
  const cubes = new Set<THREE.Object3D>(blocks.map(({ cube }) => cube));
  for (let index = appearing.length - 1; index >= 0; index--) {
    const entry = appearing[index];
    if (!entry.cube || !cubes.has(entry.cube)) continue;
    entry.effect.finish();
    entry.edges.forEach((edge) => (edge.visible = true));
    appearing.splice(index, 1);
  }
}

function refillHand(): void {
  const drawn = game.refillHand();
  const replacements: RenderedBlock[] = [];
  for (const block of drawn) {
    const rendered = createCube(block, cubeSize / 3, "hand");
    handBlocks.push(rendered);
    replacements.push(rendered);
  }
  // Also closes the gap when the deck has run out and nothing was drawn.
  syncHandSlots();
  updateHud();
  // Drawn left to right, one after another.
  replacements.sort((a, b) => a.handSlot! - b.handSlot!);
  replacements.forEach((rendered, index) => {
    const edges = [...rendered.cube.children];
    edges.forEach((edge) => (edge.visible = false));
    rendered.cube.updateWorldMatrix(true, true);
    const effect = createMaterialise(rendered.cube, { seconds: 0.9, reduced: reducedMotion });
    appearing.push({
      effect,
      edges,
      cube: rendered.cube,
      wait: index * drawStagger,
      sound: true,
    });
  });
}

/** Seconds into a play when the flight has reached its cell and the handover starts. */
const handoverAt = 1;
/** Seconds the handover dissolve takes. */
const handoverSeconds = 0.55;

/**
 * Transparent blocks (the trait) hand over with a dissolve once they land, from their hand
 * preview to their table version; opaque blocks just land.
 */
function needsHandover(rendered: RenderedBlock): boolean {
  return isTransparent(rendered.block);
}

/** The table's version of a block, in its cell but not yet visible (it dissolves in). */
function landing(block: CardBlock, cell: Cell): RenderedBlock {
  const target = createCube(block, cubeSize, "board");
  target.cell = cell;
  target.baseY = cell.y * cubeSize - 0.45;
  target.cube.position.set(cell.x * cubeSize, target.baseY, cell.z * cubeSize);
  target.cube.visible = false;
  return target;
}

/**
 * Play one block, or a line of several (in selection order) as one play: each flies from
 * the hand to its cell, setting off one after another.
 */
function startPlacement(sources: readonly RenderedBlock[], candidate: Candidate): boolean {
  const ids = sources.map(({ block }) => block.id);
  const next = game.play({
    cardId: ids[0],
    cardIds: ids,
    targetId: candidate.target?.block.id,
    face: candidate.face ?? undefined,
  });
  if (!next) return false;
  settleAppearing(sources);
  const landed = next.field.slice(-sources.length);
  const played = new Set(ids);
  selected = new Set([...selected].filter((id) => !played.has(id)));
  for (const source of sources) handBlocks.splice(handBlocks.indexOf(source), 1);
  syncHandSlots();
  // The cameras use different projections. Match each hand cube's screen position and
  // apparent size in the board view, then let the assembly carry it as it wobbles.
  handCamera.updateWorldMatrix(true, false);
  camera.updateWorldMatrix(true, false);
  const forward = camera.getWorldDirection(new THREE.Vector3());
  const depth =
    (handCamera.top - handCamera.bottom) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  const boardRay = new THREE.Raycaster();
  const flights = sources.map((source, index): Flight => {
    const { block, cell } = landed[index];
    source.block = block;
    source.cube.updateWorldMatrix(true, false);
    const screenPosition = source.cube.getWorldPosition(new THREE.Vector3()).project(handCamera);
    boardRay.setFromCamera(new THREE.Vector2(screenPosition.x, screenPosition.y), camera);
    const boardPosition = boardRay.ray.at(
      depth / boardRay.ray.direction.dot(forward),
      new THREE.Vector3(),
    );
    scene.add(source.cube);
    source.cube.position.copy(boardPosition);
    assembly.attach(source.cube);
    return {
      source,
      cell,
      delay: index * lineStagger,
      fromPosition: source.cube.position.clone(),
      fromRotation: source.cube.quaternion.clone(),
      fromScale: source.cube.scale.x,
      target: needsHandover(source) ? landing(block, cell) : null,
      handedOver: false,
    };
  });
  pendingAction = { kind: "play", flights, startedAt: performance.now(), effects: [] };
  playSfx("card.place.fly");
  updateHud();
  return true;
}

/** Discard one or more hand blocks as a single discard. */
function startDiscard(sources: readonly RenderedBlock[]): boolean {
  const coinsBefore = game.state.coins;
  const passivesBefore = game.state.passiveRack.length;
  if (!sources.length || !game.discard(sources.map(({ block }) => block.id))) return false;
  settleAppearing(sources);
  if (game.state.coins > coinsBefore) playSfx("passive.coins");
  if (game.state.passiveRack.length > passivesBefore) playSfx("passive.granted");
  passiveRackView?.render(game.state.passiveRack);
  for (const source of sources) handBlocks.splice(handBlocks.indexOf(source), 1);
  syncHandSlots();
  const gone = new Set(sources.map(({ block }) => block.id));
  selected = new Set([...selected].filter((id) => !gone.has(id)));
  const effects = sources.map((source) => {
    source.cube.children.forEach((edge) => (edge.visible = false));
    source.cube.updateWorldMatrix(true, true);
    return createMaterialise(source.cube, { seconds: 1, out: true, reduced: reducedMotion });
  });
  pendingAction = {
    kind: "discard",
    sources: [...sources],
    startedAt: performance.now(),
    effects,
  };
  playSfx("card.discard");
  updateHud();
  return true;
}

const placementTarget = new THREE.Vector3();
const placementRotation = new THREE.Quaternion();
function updateAction(now: number, delta: number): void {
  for (let index = appearing.length - 1; index >= 0; index--) {
    const entry = appearing[index];
    const { effect, edges } = entry;
    // Not its turn yet: it stays invisible (the dissolve has not started).
    if (entry.wait && entry.wait > 0) {
      entry.wait -= delta;
      continue;
    }
    if (entry.sound) {
      entry.sound = false;
      playSfx("card.deal");
    }
    if (effect.update(delta)) continue;
    edges.forEach((edge) => (edge.visible = true));
    appearing.splice(index, 1);
  }
  if (!pendingAction) return;
  const action = pendingAction;
  const elapsed = (now - action.startedAt) / 1000;
  if (action.kind === "play") {
    for (const flight of action.flights) {
      const flying = elapsed - flight.delay;
      const progress = tweenValue(0, 1, Math.max(0, flying), 1);
      placementTarget.set(
        flight.cell.x * cubeSize,
        flight.cell.y * cubeSize - 0.45,
        flight.cell.z * cubeSize,
      );
      flight.source.cube.position.lerpVectors(flight.fromPosition, placementTarget, progress);
      flight.source.cube.quaternion.copy(flight.fromRotation).slerp(placementRotation, progress);
      flight.source.cube.scale.setScalar(THREE.MathUtils.lerp(flight.fromScale, 3, progress));
      // Landed: the flying preview burns away as the table's version burns in, in place.
      if (flight.target && !flight.handedOver && flying >= handoverAt) {
        flight.handedOver = true;
        for (const cube of [flight.source.cube, flight.target.cube]) {
          cube.children.forEach((edge) => (edge.visible = false));
          cube.updateWorldMatrix(true, true);
        }
        flight.target.cube.visible = true;
        action.effects.push(
          // The preview gives way exactly where the table's version arrives: the same
          // noise, so every point shows one or the other, never neither.
          createMaterialise(flight.source.cube, {
            seconds: handoverSeconds,
            replaced: true,
            reduced: reducedMotion,
          }),
          createMaterialise(flight.target.cube, {
            seconds: handoverSeconds,
            reduced: reducedMotion,
          }),
        );
      }
    }
  }
  action.effects.forEach((effect) => effect.update(delta));
  // A play lasts until its last block has landed (and handed over, if it does).
  const lasts =
    action.kind === "play"
      ? Math.max(
          ...action.flights.map(
            ({ delay, target }) => delay + (target ? handoverAt + handoverSeconds + 0.05 : 1),
          ),
        )
      : 1;
  if (elapsed < lasts) return;
  pendingAction = null;
  if (action.kind === "play") {
    action.effects.forEach((effect) => effect.finish());
    for (const flight of action.flights) {
      if (flight.target) {
        disposeCube(flight.source);
        flight.target.cube.visible = true;
        flight.target.cube.children.forEach((edge) => (edge.visible = true));
        placed.set(cellKey(flight.cell), flight.target);
      } else {
        // Same look in hand and on the table: the flying block simply stays.
        const { source, cell } = flight;
        source.location = "board";
        source.cell = cell;
        source.baseY = cell.y * cubeSize - 0.45;
        source.rock = null;
        source.handSlot = null;
        placed.set(cellKey(cell), source);
      }
      updateRotationCenter(flight.cell);
    }
    showSelection();
    playSfx("card.attach");
    announceScore(now);
    scheduleCameraMove();
    refillHand();
  } else {
    action.sources.forEach(disposeCube);
    refillHand();
  }
  autosave();
}

/** Present the lines from the play that just landed, lowest score first. */
function announceScore(now: number): void {
  const lines = presentationOrder(game.lastScoredLines);
  scoreSteps = lines.map((line, index) => ({ at: now + index * lineStepMs, line }));
  // Let the last line's tint finish before announcing a stage outcome.
  outcomeAt = lines.length > 0 ? now + (lines.length - 1) * lineStepMs + tintSeconds * 1000 : now;
}

/** Reusable effect: briefly tint a row of placed blocks toward gold. */
function tintRow(blocks: readonly CardBlock[], now: number): void {
  const ids = new Set(blocks.map(({ id }) => id));
  tints.push({ blocks: renderedBlocks.filter(({ block }) => ids.has(block.id)), startedAt: now });
}

function updateScoring(now: number): void {
  while (scoreSteps.length > 0 && scoreSteps[0].at <= now) {
    const { line } = scoreSteps.shift()!;
    tintRow(line.line.blocks, now);
    const sound = magnitudeSfxFor(line.points);
    if (sound) playSfx(sound, { jitter: 0 });
    shownScore += line.points;
    updateHud();
  }
  if (outcomeAt !== null && outcomeAt <= now) {
    outcomeAt = null;
    shownScore = game.state.round.score;
    const outcome = roundOutcome(game.state);
    if (outcome === "won") {
      playSfx("round.cleared");
      stageWonAt = now + stageWonDelayMs;
    }
    if (outcome === "lost") {
      playSfx("round.failed");
      gameOverAt = now + gameOverDelayMs;
    }
    updateHud();
  }
  if (stageWonAt !== null && stageWonAt <= now && !pendingAction) {
    stageWonAt = null;
    showStageWon();
  }
  if (gameOverAt !== null && gameOverAt <= now && !pendingAction) {
    gameOverAt = null;
    if (game.advance()) endRun();
  }
  for (let index = tints.length - 1; index >= 0; index--) {
    const tint = tints[index];
    const progress = Math.min(1, (now - tint.startedAt) / 1000 / tintSeconds);
    const strength = Math.sin(progress * Math.PI) * 0.7;
    tint.blocks.forEach(({ materials }) => {
      new Set(materials).forEach((material) =>
        material.color.setRGB(1, 1, 1).lerp(tintColor, strength),
      );
    });
    if (progress === 1) tints.splice(index, 1);
  }
}

/** Remove every block from the scene and put the board and camera back at the start. */
function resetTable(): void {
  // disposeCube removes from renderedBlocks, so iterate over a copy.
  for (const rendered of renderedBlocks.slice()) disposeCube(rendered);
  placed.clear();
  handBlocks.length = 0;
  appearing.length = 0;
  tints.length = 0;
  selected = new Set();
  massCenter = { count: 0, sum: { x: 0, y: 0, z: 0 } };
  pivotCell.set(0, 0, 0);
  pivot.position.set(0, 0, 0);
  assembly.position.set(0, 0, 0);
  manualYaw = manualPitch = 0;
  cameraMove = null;
  const desired = desiredCamera();
  cameraDistance = desired.distance;
  cameraTarget.copy(desired.target);
  applyCamera();
  shownScore = game.state.round.score;
}

/** Deal the hand of a new stage into the hand area with the materialise effect. */
function dealHand(): void {
  game.state.hand.forEach((block, slot) => {
    const rendered = createCube(block, cubeSize / 3, "hand");
    rendered.handSlot = slot;
    handBlocks.push(rendered);
    const edges = [...rendered.cube.children];
    edges.forEach((edge) => (edge.visible = false));
    rendered.cube.updateWorldMatrix(true, true);
    appearing.push({
      effect: createMaterialise(rendered.cube, { seconds: 0.9, reduced: reducedMotion }),
      edges,
      cube: rendered.cube,
    });
  });
  layoutHand();
}

// ----- Music: the controller decides transitions; the game just says what is happening -----
let screen: "title" | "settings" | "game" | "over" = "title";

/** A stage has just started: boss stages get the boss loop, others a random vibe. */
function musicForNewStage(): void {
  if (game.phase === "boss") music.switchToBossTrack();
  else music.switchToRandomStageTrack();
}

/** Browsers keep audio silent until the player interacts; start music on the first gesture. */
const unlockMusic = () => music.unlock();
window.addEventListener("pointerdown", unlockMusic, { capture: true });
window.addEventListener("keydown", unlockMusic, { capture: true });

/** When a won stage's outcome has been announced, the stage-won pop-up follows. */
let stageWonAt: number | null = null;
const stageWonDelayMs = 900;

/**
 * The stage-won pop-up: pays the stage's rewards (once; showing it again pays nothing)
 * and counts the ledger in, then its button moves on to the next stage or the shop.
 */
function showStageWon(): void {
  const reward = game.claimStageRewards();
  if (!reward) return;
  updateHud();
  autosave();
  menus.showStageWon(reward, game.phase === "boss" ? "Visit shop" : "Start next stage", () =>
    advanceFromStage(),
  );
}

/** The HUD button: move to the next stage, the shop, the next round, or a new game. */
function takeNextAction(): void {
  if (pendingAction || drag?.active) return;
  playSfx("ui.click");
  if (game.phase === "over") {
    menus.showGameOver(game.stats);
    return;
  }
  // A won stage moves on through its pop-up, which shows what it paid.
  if (game.inStage && roundOutcome(game.state) === "won") {
    showStageWon();
    return;
  }
  advanceFromStage();
}

/** Leave the current stage or the shop: the next stage, the shop, or game over. */
function advanceFromStage(): void {
  if (pendingAction || drag?.active) return;
  const moved = game.phase === "shop" ? game.leaveShop() : game.advance();
  if (!moved) return;
  // advance() may have ended the run (TypeScript still has the pre-call narrowing).
  if ((game.phase as Phase) === "over") {
    endRun();
    return;
  }
  game = stockShopIfNeeded(game);
  resetTable();
  if (game.inStage) {
    musicForNewStage();
    dealHand();
    playSfx("round.start");
  } else if (game.phase === "shop") {
    playSfx("shop.open");
  }
  shopView?.render(game.state.shopStock ?? [], game.phase === "shop");
  updateHud();
  autosave();
}

/** The run is lost: the table stays behind the game over screen, which shows the totals. */
function endRun(): void {
  gameOverAt = null;
  playSfx("run.lost");
  updateHud();
  autosave();
  menus.showGameOver(game.stats);
}

/** When a lost stage's outcome has been announced, the game over screen follows. */
let gameOverAt: number | null = null;
const gameOverDelayMs = 1400;

/** Save at a safe point: never while a placement, discard or score presentation is running. */
function autosave(): void {
  saveRun(storage, game.snapshot(), runSaveKey);
}

/** A new run: material samples in dev0/1; dev2 rack is filled in startRun. */
function newSession(): GameSession {
  cards = roomDeck(true);
  const session = new GameSession(dealerRegistry, sessionConfig, cards);
  if (roomTraits.shopPreview) {
    const snapshot = session.snapshot();
    return GameSession.fromSnapshot(dealerRegistry, sessionConfig, cards, {
      ...snapshot,
      phase: "shop",
      state: shopPreviewState(
        snapshot.state,
        roomTraits.shopPreview.coins,
        Math.random,
        roomTraits.shop,
      ),
    });
  }
  if (!roomTraits.materialSample) return session;
  const { state } = session;
  const sample = sampleMaterials(state.deck);
  return GameSession.fromSnapshot(dealerRegistry, sessionConfig, cards, {
    ...session.snapshot(),
    state: { ...state, field: sample.field, deck: sample.deck },
  });
}

/** The shop trait supplies stock when entering, including saves from before offers existed. */
function stockShopIfNeeded(session: GameSession): GameSession {
  if (!roomTraits.shop || session.phase !== "shop" || session.state.shopStock !== undefined)
    return session;
  const snapshot = session.snapshot();
  return GameSession.fromSnapshot(dealerRegistry, sessionConfig, cards, {
    ...snapshot,
    state: shopPreviewState(snapshot.state, snapshot.state.coins, Math.random, roomTraits.shop),
  });
}

/** Swap in a session (new or resumed) and rebuild the scene from its state. */
function startRun(session: GameSession): void {
  session = stockShopIfNeeded(session);
  game = session;
  const rack = roomTraits.passiveRack;
  if (rack?.startWith) game.fillPassiveRack(Math.min(rack.startWith, rack.capacity));
  passiveRackView?.render(game.state.passiveRack);
  gameOverAt = null;
  // A run resumed on a won stage moves on from its pop-up (paid once; see the session).
  stageWonAt = game.inStage && roundOutcome(game.state) === "won" ? performance.now() + 400 : null;
  pendingAction = null;
  scoreSteps = [];
  outcomeAt = null;
  resetTable();
  for (const { block, cell } of game.state.field) addToBoard(block, cell);
  const desired = desiredCamera();
  cameraDistance = desired.distance;
  cameraTarget.copy(desired.target);
  applyCamera();
  if (game.inStage) dealHand();
  shopView?.render(game.state.shopStock ?? [], game.phase === "shop");
  updateHud();
  showSelection();
  autosave();
  playSfx(game.phase === "shop" ? "shop.open" : "round.start");
  if (game.inStage) musicForNewStage();
}

const menus = createMenus(host, settings, {
  hasSave: () => loadRun(storage, cards, dealerRegistry, runSaveKey) !== null,
  onContinue() {
    const snapshot = loadRun(storage, cards, dealerRegistry, runSaveKey);
    if (snapshot) {
      startRun(GameSession.fromSnapshot(dealerRegistry, sessionConfig, cards, snapshot));
    }
  },
  onNewGame() {
    startRun(newSession());
  },
  onSettingsChange(next) {
    applySettings(next);
    saveSettings(storage, next);
  },
  onScreen(next) {
    screen = next;
    // Leaving the menu takes the muffle off again.
    if (next !== "settings") music.unmuffle();
    if (next === "title") music.playTitle();
    // The menu muffles whatever is playing instead of changing the song.
    else if (next === "settings") music.muffle();
    else if (next === "over") music.windDown();
    else music.resumeStage();
  },
});
// Rooms that skip the title start straight in play (resuming their run if they keep one).
const skipTitle = roomTraits.skipTitle;
if (skipTitle) {
  const saved =
    skipTitle.resume && !restartRoom ? loadRun(storage, cards, dealerRegistry, runSaveKey) : null;
  startRun(
    saved ? GameSession.fromSnapshot(dealerRegistry, sessionConfig, cards, saved) : newSession(),
  );
  menus.closeAll();
} else if (restartRoom) {
  startRun(newSession());
  menus.closeAll();
} else menus.showTitle();
// Quiet rooms: the record player starts wound down.
if (roomTraits.quiet) music.windDown();
if (restartRoom) {
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("restart");
  window.history.replaceState(window.history.state, "", cleanUrl);
}
const unbindScreenshot = bindScreenshotShortcut(host, renderer, render);
stat("action").addEventListener("click", takeNextAction);

// ----- Developer console: ~ (or `) drops it down -----
createConsole({
  game: () => game,
  screen: () => screen,
  next: takeNextAction,
  newGame() {
    startRun(newSession());
    menus.closeAll();
  },
  home: () => menus.showTitle(),
  room: () => (thisRoom.dev ? thisRoom.id : null),
  rooms: () => devRooms(),
  resetRoom(room) {
    const currentRoom = thisRoom.dev ? thisRoom.id : null;
    if (!room || room === currentRoom) {
      startRun(newSession());
      menus.closeAll();
      return;
    }
    // Switching to a different dev room uses its one-shot restart URL.
    const url = new URL(window.location.href);
    url.searchParams.set("room", room);
    url.searchParams.set("restart", "true");
    window.location.assign(url);
  },
  forceOutcome(outcome) {
    if (pendingAction || !game.forceOutcome(outcome)) return false;
    shownScore = game.state.round.score;
    scoreSteps = [];
    outcomeAt = null;
    updateHud();
    autosave();
    // A won stage shows its pop-up, as if the win had been scored.
    if (outcome === "won") stageWonAt = performance.now();
    return true;
  },
  adjustCoins(delta) {
    const balance = game.adjustCoins(delta);
    updateHud();
    autosave();
    return balance;
  },
  musicTracks: () => music.tracks,
  musicNow: () => music.current,
  playMusic(id) {
    music.unlock();
    music.play(id);
  },
  stopMusic: () => music.stop(),
});

/** The blocks a drag plays, in the order they were selected (the dragged one alone if none). */
function playOrder(activeDrag: Drag): RenderedBlock[] {
  if (!activeDrag.group.length) return [activeDrag.source];
  const carried = [activeDrag.source, ...activeDrag.group];
  return [...selected]
    .map((id) => carried.find(({ block }) => block.id === id))
    .filter((rendered): rendered is RenderedBlock => Boolean(rendered));
}

function finishDrag(drop: boolean): void {
  if (!drag) return;
  const activeDrag = drag;
  if (activeDrag.active) {
    if (drop) updateCandidate();
    const candidate = drop ? activeDrag.candidate : null;
    const discard = drop && activeDrag.discardTarget;
    const refusedAtBin = drop && activeDrag.refused;
    const reorderSlot = drop ? activeDrag.reorderSlot : null;
    drag = null;
    for (const rendered of [activeDrag.source, ...activeDrag.group])
      setDragLayer(rendered.cube, false);
    showCandidate(null);
    discardArea.classList.remove("is-target", "is-refused");
    if (refusedAtBin) flashRefused(discardArea);
    const accepted = discard
      ? startDiscard([activeDrag.source, ...activeDrag.group])
      : candidate
        ? startPlacement(playOrder(activeDrag), candidate)
        : false;
    const from = game.state.hand.indexOf(activeDrag.source.block);
    if (!accepted && reorderSlot !== null && reorderSlot !== from) {
      // A drop inside the hand reorders it: not a play or discard, and nothing refills.
      game.reorderHand(from, reorderSlot);
      handScene.add(activeDrag.source.cube);
      activeDrag.source.cube.position.z = 0;
      syncHandSlots();
      playSfx("hand.reorder");
      autosave();
    } else if (!accepted) {
      // A drop the rules refuse (or any drop with no plays left) is denied; a drop on
      // empty space just returns the block to the hand.
      const refused =
        drop &&
        (discard ||
          candidate ||
          !game.dealer.canPlay(game.state) ||
          overDiscardArea(activeDrag.lastX, activeDrag.lastY));
      playSfx(refused ? "action.denied" : "card.drag.return");
      for (const rendered of [activeDrag.source, ...activeDrag.group]) {
        handScene.add(rendered.cube);
        rendered.cube.position.z = 0;
      }
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
  if (event.pointerType === "touch") {
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size >= 2) {
      // A second finger changes the gesture, never places or discards a card.
      if (drag) finishDrag(false);
      if (boardDrag) finishBoardDrag();
      pinch = { zoom: boardZoom, distance: touchSpread() };
      for (const id of touches.keys()) renderer.domElement.setPointerCapture(id);
      suppressClickUntil = performance.now() + 400;
      soundZoom();
      return;
    }
    if (pinch) return;
  }
  tooltip.hidden = true;
  const source = pickBlock(event.clientX, event.clientY, handBlocks);
  if (fieldPlacementActive(roomTraits, game.phase) && source?.block.traits.attachable) {
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
      refused: false,
      group: [],
      reorderSlot: null,
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
  const finger = touches.get(event.pointerId);
  if (finger) {
    finger.x = event.clientX;
    finger.y = event.clientY;
    if (pinch) {
      if (touches.size >= 2) applyBoardZoom(pinchZoom(pinch.zoom, pinch.distance, touchSpread()));
      return;
    }
  }
  if (drag?.pointerId === event.pointerId) {
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 8) {
      drag.active = true;
      // Dragging a selected block carries the rest of the hand selection with it.
      if (selected.has(drag.source.block.id)) {
        const source = drag.source;
        drag.group = selectedHandBlocks().filter((rendered) => rendered !== source);
      }
      for (const rendered of [drag.source, ...drag.group]) setDragLayer(rendered.cube, true);
      renderer.domElement.setPointerCapture(event.pointerId);
      changeMotionRate(normalMotionRate / 10);
      playSfx("card.pickup");
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
  if (event.pointerType === "touch") {
    touches.delete(event.pointerId);
    if (pinch) {
      suppressClickUntil = performance.now() + 400;
      if (touches.size === 0) pinch = null;
      return;
    }
  }
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
  if (event.pointerType === "touch") {
    touches.delete(event.pointerId);
    if (pinch) {
      suppressClickUntil = performance.now() + 400;
      if (touches.size === 0) pinch = null;
      return;
    }
  }
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
  const wasSelected = selected.has(target.block.id);
  selected = toggleBlockSelection(selected, target.block);
  const isSelected = selected.has(target.block.id);
  if (isSelected !== wasSelected) playSfx(isSelected ? "card.select" : "card.deselect");
  showSelection();
  updateDiscardCount();
};
/** Click or tap the bin: discard the selected hand blocks as one discard. */
discardArea.addEventListener("click", () => {
  // While it reads Sell (a passive is being dragged) the target never discards.
  if (passiveDrag || discardArea.classList.contains("is-sell")) return;
  if (pendingAction || drag?.active || !game.inStage) return;
  const chosen = selectedHandBlocks();
  if (!chosen.length) return;
  if (!game.dealer.canDiscard(game.state) || !startDiscard(chosen)) {
    flashRefused(discardArea);
    playSfx("action.denied");
  }
});
const onWheel = (event: WheelEvent) => {
  if (menus.isOpen) return;
  event.preventDefault();
  applyBoardZoom(wheelZoom(boardZoom, event.deltaY, event.deltaMode));
  soundZoom();
};
const onBlur = () => {
  if (drag) finishDrag(false);
  if (boardDrag) finishBoardDrag();
  touches.clear();
  pinch = null;
};
renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("pointermove", onPointerMove);
renderer.domElement.addEventListener("pointerleave", onPointerLeave);
renderer.domElement.addEventListener("pointerup", onPointerUp);
renderer.domElement.addEventListener("pointercancel", onPointerCancel);
renderer.domElement.addEventListener("click", onClick);
renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
window.addEventListener("blur", onBlur);

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
  handBaseY = -halfHeight + 0.48;
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
  updateScoring(time);
  glideHand(delta);
  cardRoom.frame(pivot.position, structureRadius(), delta);
  // Hand blocks rock gently; a selected one eases into a quick, small vibration.
  for (const rendered of handBlocks) {
    if (!rendered.rock) continue;
    const step = stepRock(
      rendered.rock,
      rendered.rockState ?? { angle: time / 1000, excitement: 0 },
      selected.has(rendered.block.id),
      Math.min(delta, 0.1),
    );
    rendered.rockState = step.state;
    rendered.cube.rotation.z = step.angle;
  }
  if (drag?.active) updateCandidate();
  updateEmptyFieldPrompt(time);
  passiveRackView?.frame(time, reducedMotion);
  shopView?.frame();
  render();
  frame = requestAnimationFrame(animate);
};
frame = requestAnimationFrame(animate);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unbindScreenshot();
    cancelAnimationFrame(frame);
    observer.disconnect();
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
    renderer.domElement.removeEventListener("click", onClick);
    renderer.domElement.removeEventListener("wheel", onWheel);
    window.removeEventListener("blur", onBlur);
    pendingAction?.effects.forEach((e) => e.finish());
    appearing.forEach(({ effect }) => effect.finish());
    renderedBlocks.slice().forEach(disposeCube);
    ghostGeometry.dispose();
    ghostMaterial.dispose();
    ghostEdgeGeometry.dispose();
    ghostEdgeMaterial.dispose();
    faceGeometry.dispose();
    faceMaterial.dispose();
    passiveRackView?.dispose();
    shopView?.dispose();
    renderer.dispose();
  });
}
