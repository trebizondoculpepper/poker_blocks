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
import type { Cell } from "./traits/attachable";
import { playSfx, setSfxMuted, setSfxVolume } from "./audio/sfx";
import { createAudioService, type AudioService } from "./audio-service";
import { createHudPanels, type HudPanels } from "./hud-panels";
import { createConsoleHost } from "./console-host";
import { createOverlays, type Overlays } from "./overlays";
import { createBlockViews, type BlockViews, type RenderedBlock } from "./rendered-blocks";
import { createHandView, type HandView } from "./hand-view";
import { createFieldView, tintSeconds, type Candidate, type FieldView } from "./field-view";
import { createDiscardTarget, createTableInput, type TableInput } from "./table-input";
import { musicTracks } from "./audio/music-catalog";
import { createMusicController } from "./audio/music-controller";
import { createMusicPlayer } from "./audio/music-player";
import { browserStorage, loadRun, saveRun } from "./save";
import { createCameraViewService, type CameraViewService } from "./camera-view";
import { bindScreenshotShortcut } from "./screenshot";
import { createPassiveRack } from "./passive-rack";
import { shopPreviewState } from "./shop-stock";
import { createShopView } from "./shop-view";
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
const discardArea = createDiscardTarget(host);

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
  onPickUp: (block, event) => input.pickUpPassive(block, event),
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
    input: TableInput;
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
    get input() {
      return input;
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
  drag: () => input.handDrag(),
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
  input.refreshDiscardTarget();
}

const input: TableInput = createTableInput({
  host,
  canvas: renderer.domElement,
  discardArea,
  cameraView,
  hand,
  field,
  overlays: () => overlays,
  audio,
  rack: passiveRackView,
  cubeSize,
  setDragLayer,
  onSelectionChange: () => showSelection(),
  routeToScenes: (event) => sceneManager.dispatch(event),
  rules: {
    busy: () => pendingAction !== null,
    fieldActive: () => fieldPlacementActive(roomTraits, game.phase),
    inStage: () => game.inStage,
    canPlay: () => game.dealer.canPlay(game.state),
    canDiscard: () => game.dealer.canDiscard(game.state),
    linePlacement: (count, targetId, face) =>
      game.dealer.linePlacementFor(game.state, count, targetId, face),
    hand: () => game.state.hand,
    play: startPlacement,
    discard: startDiscard,
    reorderHand(from, to) {
      game.reorderHand(from, to);
      autosave();
    },
    passiveRack: () => game.state.passiveRack,
    // Not once the run is over, mid-play, or while a won stage's rewards are unpaid.
    canSellPassives: () => game.phase !== "over" && !pendingAction && !game.stageRewardsPending,
    reorderPassive(from, to) {
      if (!game.reorderPassive(from, to)) return false;
      passiveRackView.render(game.state.passiveRack);
      autosave();
      return true;
    },
    sellPassive(id) {
      if (game.sellPassive(id) === null) return false;
      passiveRackView.render(game.state.passiveRack);
      updateHud();
      autosave();
      return true;
    },
  },
});
updateHud();

function showSelection(): void {
  const selected = input.selection;
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
  const idle = Boolean(cell) && !input.dragging && !pendingAction;
  field.showPrompt(idle ? cell : null, time, reducedMotion);
}

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
  input.deselect(played);
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
  input.deselect(sources.map(({ block }) => block.id));
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
  input.clearSelection();
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
  if (pendingAction || input.dragging) return;
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
  if (shopExitPending || pendingAction || input.dragging) return;
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
  hand.animate(time, delta, input.selection);
  cardRoom.frame(cameraView.pivot.position, cameraView.structureRadius(), delta);
  input.frame();
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
    input.dispose();
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
