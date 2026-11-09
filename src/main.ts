import "./style.css";
import * as THREE from "three";
import { cardName, standardDeck, type CardBlock } from "./cards";
import { makeDevDeck } from "./materials";
import { sampleMaterials } from "./material-sampler";
import { dealerRegistry, roundOutcome } from "./dealer";
import { presentationOrder, type ScoredLine } from "./scoring";
import { magnitudeSfxFor } from "./score-presentation";

import { GameSession, type Phase } from "./game-session";
import { demoSessionConfig, sandboxSessionConfig, type SessionConfig } from "./session-config";
import { tweenValue } from "./easing";
import { createMaterialise } from "./visual/materialise";
import { isTransparent } from "./traits/transparent";
import { createCardRoom } from "./visual/card-room";
import { setReflectionEnvironment } from "./visual/block-appearance";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { cellKey, type Cell } from "./traits/attachable";
import { toggleBlockSelection, type Selection } from "./traits/selectable";
import { inspectBlock } from "./traits/inspectable";
import { playSfx, setSfxMuted, setSfxVolume } from "./audio/sfx";
import { createAudioService, type AudioService } from "./audio-service";
import { createHudPanels, type HudPanels } from "./hud-panels";
import { createConsoleHost } from "./console-host";
import { createOverlays, type Overlays } from "./overlays";
import { createBlockViews, type BlockViews, type RenderedBlock } from "./rendered-blocks";
import { createHandView, type HandView } from "./hand-view";
import { createFieldView, tintSeconds, type Candidate, type FieldView } from "./field-view";
import { musicTracks } from "./audio/music-catalog";
import { createMusicController } from "./audio/music-controller";
import { createMusicPlayer } from "./audio/music-player";
import { browserStorage, loadRun, saveRun } from "./save";
import { createCameraViewService, type CameraViewService } from "./camera-view";
import { bindScreenshotShortcut } from "./screenshot";
import { createPassiveRack } from "./passive-rack";
import { shopPreviewState } from "./shop-stock";
import { createShopView } from "./shop-view";
import { moveItem } from "./zones";
import {
  fieldPlacementActive,
  overlaysForPhase,
  roomFor,
  roomRegistry,
  roomLink,
  roomSceneId,
  type RoomSceneName,
  type RoomSceneTraits,
  wantsRestart,
  type Room,
} from "./rooms";
import { SceneManager, SceneTraitRegistry } from "./scenes";
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
const hud: HudPanels = createHudPanels(host);
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

const scene = new THREE.Scene();
const handScene = new THREE.Scene();
let cameraView: CameraViewService;
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
  renderer.render(scene, cameraView.camera);
  renderer.clearDepth();
  cameraView.handCamera.layers.set(0);
  renderer.render(handScene, cameraView.handCamera);
  // Dragged blocks last, on a fresh depth buffer, so nothing can clip into them.
  renderer.clearDepth();
  cameraView.handCamera.layers.set(dragLayer);
  renderer.render(handScene, cameraView.handCamera);
  cameraView.handCamera.layers.set(0);
}

/** Selected block ids (hand and field). Declared early: the first HUD update reads it. */
let selected: Selection = new Set();
const cubeSize = 2.4;
cameraView = createCameraViewService({
  host,
  renderer,
  scene,
  cubeSize,
  getCells: () => field.cells(),
  getMassCenter: () => field.massCenter,
  layoutHand,
  render,
});
const { assembly } = cameraView;
const blockViews: BlockViews = createBlockViews({ board: assembly, hand: handScene });
const field: FieldView = createFieldView({
  views: blockViews,
  assembly,
  cubeSize,
  onCenter: (center) => cameraView.updateRotationCenter(center),
});

const storage = browserStorage();
/**
 * Rooms (?room=...) are composed from room traits; see src/rooms.ts. dev0 is the normal game
 * with a material on every card, dev1 samples materials, dev2 has the passive rack,
 * and dev3 opens the shop with five coins.
 */
const roomParams = new URLSearchParams(window.location.search);
/** This page's room: the normal game, or a dev room. Its traits say how it behaves. */
let thisRoom = roomFor(roomParams.get("room"));
let roomTraits = thisRoom.traits;
let restartRoom = wantsRestart(thisRoom, roomParams);
/** The room's session rules: endless sandboxes, and the passive rack's capacity. */
function sessionConfigFor(traits: typeof roomTraits): SessionConfig {
  return {
    ...(traits.sandbox ? sandboxSessionConfig(demoSessionConfig) : demoSessionConfig),
    ...(traits.passiveRack ? { rackCapacity: traits.passiveRack.capacity } : {}),
  };
}
let sessionConfig = sessionConfigFor(roomTraits);
const devSeedKey = "poker-blocks.dev-material-seed";
let runSaveKey = roomTraits.save.key;
const passiveRackView = createPassiveRack(host, {
  capacity: roomTraits.passiveRack?.capacity,
  onPickUp: (block, event) => pickUpPassive(block, event),
});
passiveRackView.element.hidden = !roomTraits.passiveRack;
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
const musicPlayer = createMusicPlayer(musicTracks);
const audio: AudioService = createAudioService({
  player: musicPlayer,
  music: createMusicController(
    musicPlayer,
    musicTracks.map(({ id }) => id),
  ),
  sfx: { setVolume: setSfxVolume, setMuted: setSfxMuted, play: (id) => playSfx(id) },
  gestures: window,
});
type TraitContext = {
  host: HTMLElement;
  services: {
    cameraView: CameraViewService;
    audio: AudioService;
    hud: HudPanels;
    overlays: Overlays;
    hand: HandView;
    field: FieldView;
  };
};
const traitContext: TraitContext = {
  host,
  services: {
    cameraView,
    audio,
    hud,
    // Built later, once the settings and run callbacks it needs exist.
    get overlays() {
      return overlays;
    },
    get hand() {
      return hand;
    },
    get field() {
      return field;
    },
  },
};
const sceneBehaviours = new SceneTraitRegistry<RoomSceneTraits, TraitContext>();
sceneBehaviours.register("screen", {
  enter(context, { kind }) {
    context.host.dataset.scene = kind;
  },
  exit(context, { kind }) {
    if (context.host.dataset.scene === kind) delete context.host.dataset.scene;
  },
});
sceneBehaviours.register("pausesBelow", {
  blocksBelow(_context, config, operation) {
    return config[operation];
  },
});
const sceneManager = new SceneManager(sceneBehaviours, traitContext);
for (const roomId of roomRegistry.names()) {
  for (const scene of roomRegistry.get(roomId).scenes) sceneManager.register(scene);
}
const sceneForPhase: Record<Phase, RoomSceneName> = {
  "stage-1": "stage-1",
  "stage-2": "stage-2",
  boss: "boss",
  shop: "shop",
  over: "game-over",
};
function sceneId(name: RoomSceneName): string {
  return roomSceneId(thisRoom.id, name);
}
function switchScene(name: RoomSceneName): void {
  const id = sceneId(name);
  if (sceneManager.current?.id !== id) sceneManager.switchTo(id);
}
function pushScene(name: RoomSceneName): void {
  sceneManager.pushIfNotCurrent(sceneId(name));
}
function syncSceneToGame(): void {
  // Temporary bridge until scene transitions drive GameSession progression (#37).
  switchScene(sceneForPhase[game.phase]);
}
// A fresh run sits behind the title screen until the player chooses Continue or New game.
let game = new GameSession(dealerRegistry, sessionConfig, cards);
for (const { block, cell } of game.state.field) field.add(block, cell);
const hand: HandView = createHandView({
  views: blockViews,
  scene: handScene,
  cubeSize,
  baseY: () => cameraView.handBaseY,
  handSize: () => game.dealer.handSize,
  reducedMotion: () => reducedMotion,
  drag: () => (drag?.active ? drag : null),
  onLayout: () => showSelection(),
});
game.state.hand.forEach((block, slot) => (hand.add(block).handSlot = slot));
const shopView = createShopView(
  host,
  passiveRackView.element,
  (offer) =>
    offer.kind === "passive" ? game.passivePrices.buy : (sessionConfig.cardPurchasePrice ?? 1),
  (id, destination) => {
    const bought = game.buyShopOffer(id, destination);
    if (!bought) {
      playSfx("action.denied");
      return false;
    }
    if (bought.kind === "card") {
      hand.add(bought.block);
      syncHandSlots();
    } else passiveRackView.render(game.state.passiveRack);
    shopView.render(game.state.shopStock ?? [], true);
    updateHud();
    autosave();
    playSfx("shop.buy");
    return true;
  },
  () => cameraView.finishShopEntrance(),
);
shopView.render([], false);
// The score shown lags the state until the placed card lands.
let shownScore = game.state.round.score;
/** One scoring line waiting to be shown: tint its row, play its sound, add its points. */
type ScoreStep = { at: number; line: ScoredLine };
const lineStepMs = 320;
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
function updateHud(): void {
  // The game state updates as soon as a placement is accepted, but the card still
  // has to land before its scoring presentation begins. Keep outcomes hidden across
  // both parts of that sequence.
  const presenting = pendingAction?.kind === "play" || scoreSteps.length > 0 || outcomeAt !== null;
  const { round, deck, coins } = game.state;
  hud.render({
    round: game.round,
    phase: game.phase,
    overlays: overlaysForPhase(roomTraits, game.phase),
    presenting,
    outcome: presenting || !game.inStage ? "playing" : roundOutcome(game.state),
    score: shownScore,
    targetScore: round.targetScore,
    movesLeft: round.movesLeft,
    discardsLeft: round.discardsLeft,
    coins,
    deckSize: deck.length,
  });
  discardArea.classList.toggle("is-exhausted", !game.dealer.canDiscard(game.state));
  updateDiscardCount();
}

/** Hand blocks currently selected, in hand order. */
function selectedHandBlocks(): RenderedBlock[] {
  return hand.selected(selected);
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

function showInspection(block: CardBlock | undefined, clientX: number, clientY: number): void {
  overlays.inspect((block && inspectBlock(block)) || null, clientX, clientY);
}

function showSelection(): void {
  blockViews.highlight(selected);
  const selectedNames = blockViews.all
    .filter(({ block }) => block.traits.selectable && selected.has(block.id))
    .map(({ block }) => cardName(block.traits.identity));
  host.setAttribute(
    "aria-label",
    `${game.state.field.length} blocks in play. Hand: ${game.state.hand.map((block) => cardName(block.traits.identity)).join(", ")}. ${game.state.deck.length} in deck. Selected: ${selectedNames.join(", ") || "none"}.`,
  );
}

/** Lay out the hand; while a reorder is previewed, neighbours make room for the dragged card. */
function layoutHand(): void {
  hand.layout();
}

/** Visual hand slots always follow the hand order held in GameState. */
function syncHandSlots(): void {
  hand.sync(game.state.hand);
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function pointRay(
  clientX: number,
  clientY: number,
  viewCamera: THREE.Camera = cameraView.camera,
): void {
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
  /** The rack slot a drop would move it to, while the pointer is over the rack. */
  slot: number | null;
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
    slot: null,
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
  // Over the rack, preview the reorder: neighbours glide aside to open the drop slot.
  const slot = passiveRackView?.slotAt(event.clientX, event.clientY) ?? null;
  if (slot !== passiveDrag.slot) {
    passiveDrag.slot = slot;
    const ids = game.state.passiveRack.map(({ id }) => id);
    const from = ids.indexOf(passiveDrag.block.id);
    passiveRackView?.preview(slot === null || from < 0 ? null : moveItem(ids, from, slot));
  }
  const over = overDiscardArea(event.clientX, event.clientY);
  const wasTarget = discardArea.classList.contains("is-target");
  discardArea.classList.toggle("is-target", over && canSellPassives());
  discardArea.classList.toggle("is-refused", over && !canSellPassives());
  if (over && canSellPassives() && !wasTarget) playSfx("discard.hover");
}

function dropPassive(event: PointerEvent, cancelled: boolean): void {
  if (!passiveDrag || event.pointerId !== passiveDrag.pointerId) return;
  const { block, floating, slot } = passiveDrag;
  passiveDrag = null;
  if (!floating) return; // a click, not a drag: the rack's tooltip handles that
  floating.remove();
  showSellTarget(false);
  passiveRackView?.lift(null);
  passiveRackView?.preview(null);
  // A drop inside the rack reorders it: not a sale, and nothing else changes.
  const from = game.state.passiveRack.findIndex(({ id }) => id === block.id);
  if (!cancelled && slot !== null && from >= 0) {
    if (slot !== from && game.reorderPassive(from, slot)) {
      playSfx("hand.reorder");
      passiveRackView?.render(game.state.passiveRack);
      autosave();
    } else playSfx("card.drag.return");
    return;
  }
  if (cancelled || !overDiscardArea(event.clientX, event.clientY)) {
    playSfx("card.drag.return");
    return;
  }
  const sold = canSellPassives() ? game.sellPassive(block.id) : null;
  if (sold === null) {
    overlays.flashRefused(discardArea);
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
  candidates: readonly RenderedBlock[] = blockViews.all,
): RenderedBlock | undefined {
  pointRay(
    clientX,
    clientY,
    candidates === hand.blocks ? cameraView.handCamera : cameraView.camera,
  );
  const hit = raycaster.intersectObjects(
    candidates.map(({ cube }) => cube),
    false,
  )[0];
  return candidates.find(({ cube }) => cube === hit?.object);
}

function pickAttachment(clientX: number, clientY: number, count = 1): Candidate | null {
  if (field.cells().length === 0) {
    // The first play of a stage goes to the centre: drop anywhere above the hand.
    const bounds = host.getBoundingClientRect();
    const aboveHand = clientY < bounds.top + bounds.height * 0.72;
    const cells = game.dealer.linePlacementFor(game.state, count);
    return aboveHand && cells ? { target: null, face: null, cell: cells[0], cells } : null;
  }
  pointRay(clientX, clientY);
  const hit = field.faceAt(raycaster);
  if (!hit) return null;
  const { target, face } = hit;
  // A line runs out from the face; it is refused whole if it would reach a block.
  const cells = game.dealer.linePlacementFor(game.state, count, target.block.id, face);
  return cells ? { target, face, cell: cells[0], cells } : null;
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
  field.showPrompt(idle ? cell : null, time, reducedMotion);
}

/** The hand position under the pointer, or null when the pointer is not over the hand. */
function handReorderSlot(clientX: number, clientY: number): number | null {
  const bounds = host.getBoundingClientRect();
  if (clientY < bounds.top + bounds.height * 0.72 || hand.blocks.length < 2) return null;
  pointRay(clientX, clientY, cameraView.handCamera);
  if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return null;
  return hand.slotAt(dragPoint.x);
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
  field.showCandidate(drag.candidate);
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
  pointRay(drag.lastX, drag.lastY, cameraView.handCamera);
  if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
    drag.source.cube.position.copy(dragPoint).add(drag.grabOffset);
    // Carried blocks trail the dragged one in a small fanned stack behind it.
    // Each is pushed a whole block further from the camera (straight back along its view,
    // so the fan on screen is unchanged) and never intersects the one in front.
    cameraView.handCamera.getWorldDirection(awayFromCamera);
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
const systemMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
let settings = loadSettings(storage);
let reducedMotion = false;
function enterRoom(room: Room, createDeck = true): void {
  thisRoom = room;
  roomTraits = room.traits;
  sessionConfig = sessionConfigFor(roomTraits);
  runSaveKey = roomTraits.save.key;
  if (createDeck) cards = roomDeck(false);
  passiveRackView.setCapacity(roomTraits.passiveRack?.capacity ?? 0);
  passiveRackView.element.hidden = !roomTraits.passiveRack;
  audio.enterRoom(room.musicMode);
}
// Configure the initial mode through the same path used by the developer room switcher.
enterRoom(thisRoom, false);
function applySettings(next: Settings): void {
  settings = next;
  audio.applySettings(next);
  reducedMotion = prefersReducedMotion(next.motion, systemMotionQuery.matches);
  cardRoom.setShadowQuality(resolveShadowQuality(next.shadows, coarsePointer));
}
applySettings(settings);
systemMotionQuery.addEventListener("change", () => applySettings(settings));
function refillHand(): void {
  // Drawn left to right, one after another; also closes the gap when the deck has run out.
  hand.drawIn(game.refillHand(), game.state.hand);
  updateHud();
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
  hand.settle(sources);
  const landed = next.field.slice(-sources.length);
  const played = new Set(ids);
  selected = new Set([...selected].filter((id) => !played.has(id)));
  hand.remove(sources);
  syncHandSlots();
  // The cameras use different projections. Match each hand cube's screen position and
  // apparent size in the board view, then let the assembly carry it as it wobbles.
  cameraView.handCamera.updateWorldMatrix(true, false);
  cameraView.camera.updateWorldMatrix(true, false);
  const forward = cameraView.camera.getWorldDirection(new THREE.Vector3());
  const depth =
    (cameraView.handCamera.top - cameraView.handCamera.bottom) /
    (2 * Math.tan(THREE.MathUtils.degToRad(cameraView.camera.fov) / 2));
  const boardRay = new THREE.Raycaster();
  const flights = sources.map((source, index): Flight => {
    const { block, cell } = landed[index];
    source.block = block;
    source.cube.updateWorldMatrix(true, false);
    const screenPosition = source.cube
      .getWorldPosition(new THREE.Vector3())
      .project(cameraView.handCamera);
    boardRay.setFromCamera(
      new THREE.Vector2(screenPosition.x, screenPosition.y),
      cameraView.camera,
    );
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
      target: needsHandover(source) ? field.landing(block, cell) : null,
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
  hand.settle(sources);
  if (game.state.coins > coinsBefore) playSfx("passive.coins");
  if (game.state.passiveRack.length > passivesBefore) playSfx("passive.granted");
  passiveRackView?.render(game.state.passiveRack);
  hand.remove(sources);
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
  hand.updateDrawIns(delta);
  if (!pendingAction) return;
  const action = pendingAction;
  const elapsed = (now - action.startedAt) / 1000;
  if (action.kind === "play") {
    for (const flight of action.flights) {
      const flying = elapsed - flight.delay;
      const progress = tweenValue(0, 1, Math.max(0, flying), 1);
      field.cellPosition(flight.cell, placementTarget);
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
        blockViews.dispose(flight.source);
        flight.target.cube.visible = true;
        flight.target.cube.children.forEach((edge) => (edge.visible = true));
        field.adopt(flight.target, flight.cell);
      } else {
        // Same look in hand and on the table: the flying block simply stays.
        field.adopt(flight.source, flight.cell);
      }
    }
    showSelection();
    playSfx("card.attach");
    announceScore(now);
    cameraView.scheduleCameraMove();
    refillHand();
  } else {
    action.sources.forEach((source) => blockViews.dispose(source));
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

function updateScoring(now: number): void {
  while (scoreSteps.length > 0 && scoreSteps[0].at <= now) {
    const { line } = scoreSteps.shift()!;
    field.tint(line.line.blocks, now);
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
  field.update(now);
}

/** Remove every block from the scene and put the board and camera back at the start. */
function resetTable(): void {
  blockViews.disposeAll();
  field.clear();
  hand.clear();
  selected = new Set();
  cameraView.reset();
  shownScore = game.state.round.score;
}

/** Deal the hand of a new stage into the hand area with the materialise effect. */
function dealHand(): void {
  hand.deal(game.state.hand);
}

/** Browsers keep audio silent until the player interacts; start music on the first gesture. */
audio.start();

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
  overlays.showStageWon(reward, "Visit shop", () => void advanceFromStage());
}

/** The HUD button: move to the next stage, the shop, the next round, or a new game. */
function takeNextAction(): void {
  if (pendingAction || drag?.active) return;
  playSfx("ui.click");
  if (game.phase === "over") {
    overlays.showGameOver(game.stats);
    return;
  }
  // A won stage moves on through its pop-up, which shows what it paid.
  if (game.inStage && roundOutcome(game.state) === "won") {
    showStageWon();
    return;
  }
  void advanceFromStage();
}

/** Leave the current stage or the shop: the next stage, the shop, or game over. */
let shopExitPending = false;
async function advanceFromStage(): Promise<void> {
  if (shopExitPending || pendingAction || drag?.active) return;
  const leavingShop = game.phase === "shop";
  if (leavingShop) shopExitPending = true;
  try {
    if (leavingShop) {
      const session = game;
      if (session.state.shopStock?.length) playSfx("shop.stock.burn");
      await shopView.burnUnsold(reducedMotion);
      // A different run may have been started while the old shop was dissolving.
      if (game !== session) return;
    }
    const moved = leavingShop ? game.leaveShop() : game.advance();
    if (!moved) return;
    // advance() may have ended the run (TypeScript still has the pre-call narrowing).
    if ((game.phase as Phase) === "over") {
      endRun();
      return;
    }
    game = stockShopIfNeeded(game);
    syncSceneToGame();
    resetTable();
    if (game.inStage) {
      audio.stageStarted(game.phase);
      dealHand();
      playSfx("round.start");
    } else if (game.phase === "shop") {
      playSfx("shop.open");
    }
    const enterShop = game.phase === "shop" && !reducedMotion;
    shopView.render(game.state.shopStock ?? [], game.phase === "shop", enterShop);
    if (enterShop) cameraView.beginShopEntrance();
    showSelection();
    updateHud();
    autosave();
  } finally {
    if (leavingShop) shopExitPending = false;
  }
}

/** The run is lost: the table stays behind the game over screen, which shows the totals. */
function endRun(): void {
  gameOverAt = null;
  playSfx("run.lost");
  updateHud();
  autosave();
  overlays.showGameOver(game.stats);
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
function startRun(session: GameSession, fresh = false): void {
  session = stockShopIfNeeded(session);
  game = session;
  const rack = roomTraits.passiveRack;
  passiveRackView.element.hidden = !rack;
  if (rack?.startWith) game.fillPassiveRack(Math.min(rack.startWith, rack.capacity));
  passiveRackView.render(game.state.passiveRack);
  gameOverAt = null;
  // A run resumed on a won stage moves on from its pop-up (paid once; see the session).
  stageWonAt = game.inStage && roundOutcome(game.state) === "won" ? performance.now() + 400 : null;
  pendingAction = null;
  scoreSteps = [];
  outcomeAt = null;
  resetTable();
  for (const { block, cell } of game.state.field) field.add(block, cell);
  cameraView.frameToStructure();
  if (game.inStage) dealHand();
  const enterShop = game.phase === "shop" && fresh && !reducedMotion;
  shopView.render(game.state.shopStock ?? [], game.phase === "shop", enterShop);
  syncSceneToGame();
  if (enterShop) cameraView.beginShopEntrance();
  updateHud();
  showSelection();
  autosave();
  playSfx(game.phase === "shop" ? "shop.open" : "round.start");
  if (game.inStage) audio.stageStarted(game.phase);
  audio.runStarted();
}

const overlays: Overlays = createOverlays(host, {
  settings,
  audio,
  reducedMotion: () => reducedMotion,
  scenes: {
    push: pushScene,
    replace: switchScene,
    resumeGame() {
      sceneManager.pop();
      syncSceneToGame();
    },
  },
  menus: {
    hasSave: () => loadRun(storage, cards, dealerRegistry, runSaveKey) !== null,
    onContinue() {
      const snapshot = loadRun(storage, cards, dealerRegistry, runSaveKey);
      if (snapshot) {
        startRun(GameSession.fromSnapshot(dealerRegistry, sessionConfig, cards, snapshot));
      }
    },
    onNewGame() {
      startRun(newSession(), true);
    },
    onSettingsChange(next) {
      applySettings(next);
      saveSettings(storage, next);
    },
  },
});
// Rooms that skip the title start straight in play (resuming their run if they keep one).
const skipTitle = roomTraits.skipTitle;
if (skipTitle) {
  const saved =
    skipTitle.resume && !restartRoom ? loadRun(storage, cards, dealerRegistry, runSaveKey) : null;
  startRun(
    saved ? GameSession.fromSnapshot(dealerRegistry, sessionConfig, cards, saved) : newSession(),
    !saved,
  );
  overlays.closeAll();
} else if (restartRoom) {
  startRun(newSession(), true);
  overlays.closeAll();
} else overlays.showTitle();
if (restartRoom) {
  window.history.replaceState(window.history.state, "", roomLink(thisRoom, window.location.href));
}
const unbindScreenshot = bindScreenshotShortcut(host, renderer, render);
hud.onAction(takeNextAction);

// ----- Developer console: ~ (or `) drops it down -----
const devConsole = createConsoleHost(
  {
    game: () => game,
    screen: () => overlays.screen,
    next: takeNextAction,
    newRun() {
      startRun(newSession());
      overlays.closeAll();
    },
    home: () => overlays.showTitle(),
    room: () => thisRoom,
    openRoom(room) {
      enterRoom(room);
      // startScene is declarative until the scene graph drives session progression (#37).
      switchScene(room.startScene);
      startRun(newSession(), true);
      overlays.closeAll();
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
  },
  audio,
);

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
    field.showCandidate(null);
    discardArea.classList.remove("is-target", "is-refused");
    if (refusedAtBin) overlays.flashRefused(discardArea);
    const accepted = discard
      ? startDiscard([activeDrag.source, ...activeDrag.group])
      : candidate
        ? startPlacement(playOrder(activeDrag), candidate)
        : false;
    const from = game.state.hand.indexOf(activeDrag.source.block);
    if (!accepted && reorderSlot !== null && reorderSlot !== from) {
      // A drop inside the hand reorders it: not a play or discard, and nothing refills.
      game.reorderHand(from, reorderSlot);
      hand.putBack([activeDrag.source]);
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
      hand.putBack([activeDrag.source, ...activeDrag.group]);
      layoutHand();
    }
    cameraView.changeMotionRate(normalMotionRate);
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
  cameraView.changeMotionRate(normalMotionRate);
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
      pinch = { zoom: cameraView.zoom, distance: touchSpread() };
      for (const id of touches.keys()) renderer.domElement.setPointerCapture(id);
      suppressClickUntil = performance.now() + 400;
      audio.zoomed();
      return;
    }
    if (pinch) return;
  }
  overlays.hideTooltip();
  const source = pickBlock(event.clientX, event.clientY, hand.blocks);
  if (fieldPlacementActive(roomTraits, game.phase) && source?.block.traits.attachable) {
    pointRay(event.clientX, event.clientY, cameraView.handCamera);
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
  if (!pickBlock(event.clientX, event.clientY, field.blocks())) return;
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
      if (touches.size >= 2) cameraView.zoomWithPinch(pinch.zoom, pinch.distance, touchSpread());
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
      cameraView.changeMotionRate(normalMotionRate / 10);
      playSfx("card.pickup");
    }
    if (drag.active) {
      overlays.hideTooltip();
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
      cameraView.changeMotionRate(0);
    }
    if (boardDrag.active) {
      overlays.hideTooltip();
      cameraView.rotateBy(dx, dy);
      renderer.domElement.style.cursor = "grabbing";
      return;
    }
  }
  const hovered =
    pickBlock(event.clientX, event.clientY, hand.blocks) ??
    pickBlock(event.clientX, event.clientY, field.blocks());
  renderer.domElement.style.cursor = hovered?.block.traits.selectable ? "pointer" : "default";
  showInspection(
    event.pointerType === "touch" ? undefined : hovered?.block,
    event.clientX,
    event.clientY,
  );
};
const onPointerLeave = () => {
  overlays.hideTooltip();
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
    pickBlock(event.clientX, event.clientY, hand.blocks) ??
    pickBlock(event.clientX, event.clientY, field.blocks());
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
  overlays.hideTooltip();
  renderer.domElement.style.cursor = "default";
};
const onClick = (event: MouseEvent) => {
  if (performance.now() < suppressClickUntil) return;
  const target =
    pickBlock(event.clientX, event.clientY, hand.blocks) ??
    pickBlock(event.clientX, event.clientY, field.blocks());
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
    overlays.flashRefused(discardArea);
    playSfx("action.denied");
  }
});
const onWheel = (event: WheelEvent) => {
  if (overlays.isOpen) return;
  event.preventDefault();
  cameraView.zoomWithWheel(event.deltaY, event.deltaMode);
  audio.zoomed();
};
const onBlur = () => {
  if (drag) finishDrag(false);
  if (boardDrag) finishBoardDrag();
  touches.clear();
  pinch = null;
};
const routeSceneInput = (event: Event) => {
  if (!sceneManager.dispatch(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
};
// This host capture route is scaffolding: current key handlers on window still receive events
// outside the host, and no registered scene trait consumes input yet.
const sceneInputEvents = [
  "keydown",
  "keyup",
  "pointerdown",
  "pointerup",
  "pointercancel",
  "click",
  "wheel",
];
for (const type of sceneInputEvents) host.addEventListener(type, routeSceneInput, true);
renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("pointermove", onPointerMove);
renderer.domElement.addEventListener("pointerleave", onPointerLeave);
renderer.domElement.addEventListener("pointerup", onPointerUp);
renderer.domElement.addEventListener("pointercancel", onPointerCancel);
renderer.domElement.addEventListener("click", onClick);
renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
window.addEventListener("blur", onBlur);

cameraView.start();

let frame = 0;
let lastTime = 0;
const animate = (time: number) => {
  const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
  lastTime = time;
  cameraView.update(time, delta);
  updateAction(time, delta);
  updateScoring(time);
  sceneManager.update(delta);
  hand.animate(time, delta, selected);
  cardRoom.frame(cameraView.pivot.position, cameraView.structureRadius(), delta);
  if (drag?.active) updateCandidate();
  updateEmptyFieldPrompt(time);
  passiveRackView?.frame(time, reducedMotion);
  shopView.frame();
  render();
  frame = requestAnimationFrame(animate);
};
frame = requestAnimationFrame(animate);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unbindScreenshot();
    cancelAnimationFrame(frame);
    cameraView.dispose();
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
    renderer.domElement.removeEventListener("click", onClick);
    renderer.domElement.removeEventListener("wheel", onWheel);
    for (const type of sceneInputEvents) host.removeEventListener(type, routeSceneInput, true);
    window.removeEventListener("blur", onBlur);
    audio.dispose();
    hud.dispose();
    devConsole.dispose();
    overlays.dispose();
    pendingAction?.effects.forEach((e) => e.finish());
    hand.dispose();
    blockViews.disposeAll();
    field.dispose();
    passiveRackView.dispose();
    shopView.dispose();
    renderer.dispose();
  });
}
