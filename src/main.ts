import "./style.css";
import * as THREE from "three";
import { cardName, standardDeck, type CardBlock } from "./cards";
import { makeDevDeck } from "./materials";
import { sampleMaterials } from "./material-sampler";
import { dealerRegistry, roundOutcome } from "./dealer";

import { GameSession, type Phase } from "./game-session";
import { demoSessionConfig, sandboxSessionConfig, type SessionConfig } from "./session-config";
import { playSfx, setSfxMuted, setSfxVolume } from "./audio/sfx";
import { createAudioService, type AudioService } from "./audio-service";
import { createHudPanels, type HudPanels } from "./hud-panels";
import { createConsoleHost } from "./console-host";
import { createOverlays, type Overlays } from "./overlays";
import { createBlockViews, type BlockViews } from "./rendered-blocks";
import { createHandView, type HandView } from "./hand-view";
import { createFieldView, type FieldView } from "./field-view";
import { createDiscardTarget, createTableInput, type TableInput } from "./table-input";
import { createTableRenderer, type TableRenderer } from "./table-renderer";
import { createPlayPresenter, type PlayPresenter } from "./play-presenter";
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

const view: TableRenderer = createTableRenderer(host);
const { renderer, scene, handScene } = view;
let cameraView: CameraViewService;
const setDragLayer = (cube: THREE.Object3D, dragging: boolean) => view.setDragLayer(cube, dragging);

function render(): void {
  view.render(cameraView.camera, cameraView.handCamera);
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
    renderer: TableRenderer;
    cameraView: CameraViewService;
    audio: AudioService;
    hud: HudPanels;
    overlays: Overlays;
    hand: HandView;
    field: FieldView;
    presenter: PlayPresenter;
    input: TableInput;
  };
};
const traitContext: TraitContext = {
  host,
  services: {
    renderer: view,
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
    get presenter() {
      return presenter;
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
const presenter: PlayPresenter = createPlayPresenter({
  game: () => game,
  views: blockViews,
  hand,
  field,
  cameraView,
  scene,
  assembly,
  reducedMotion: () => reducedMotion,
  deselect: (ids) => input.deselect(ids),
  changed: () => updateHud(),
  moved: () => showSelection(),
  rackChanged: () => passiveRackView.render(game.state.passiveRack),
  refill: () => refillHand(),
  save: () => autosave(),
  decided(outcome, now) {
    if (outcome === "won") {
      playSfx("round.cleared");
      stageWonAt = now + stageWonDelayMs;
    }
    if (outcome === "lost") {
      playSfx("round.failed");
      gameOverAt = now + gameOverDelayMs;
    }
  },
});
function updateHud(): void {
  // The game state updates as soon as a placement is accepted, but the card still
  // has to land before its scoring presentation begins. Keep outcomes hidden across
  // both parts of that sequence.
  const presenting = presenter.presenting;
  const { round, deck, coins } = game.state;
  hud.render({
    round: game.round,
    phase: game.phase,
    overlays: overlaysForPhase(roomTraits, game.phase),
    presenting,
    outcome: presenting || !game.inStage ? "playing" : roundOutcome(game.state),
    score: presenter.shownScore,
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
    busy: () => presenter.busy,
    fieldActive: () => fieldPlacementActive(roomTraits, game.phase),
    inStage: () => game.inStage,
    canPlay: () => game.dealer.canPlay(game.state),
    canDiscard: () => game.dealer.canDiscard(game.state),
    linePlacement: (count, targetId, face) =>
      game.dealer.linePlacementFor(game.state, count, targetId, face),
    hand: () => game.state.hand,
    play: (blocks, candidate) => presenter.play(blocks, candidate),
    discard: (blocks) => presenter.discard(blocks),
    reorderHand(from, to) {
      game.reorderHand(from, to);
      autosave();
    },
    passiveRack: () => game.state.passiveRack,
    // Not once the run is over, mid-play, or while a won stage's rewards are unpaid.
    canSellPassives: () => game.phase !== "over" && !presenter.busy && !game.stageRewardsPending,
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
  const idle = Boolean(cell) && !input.dragging && !presenter.busy;
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
  view.setShadowQuality(resolveShadowQuality(next.shadows, coarsePointer));
}
applySettings(settings);
systemMotionQuery.addEventListener("change", () => applySettings(settings));
function refillHand(): void {
  // Drawn left to right, one after another; also closes the gap when the deck has run out.
  hand.drawIn(game.refillHand(), game.state.hand);
  updateHud();
}
function updateScoring(now: number): void {
  presenter.updateScore(now);
  if (stageWonAt !== null && stageWonAt <= now && !presenter.busy) {
    stageWonAt = null;
    showStageWon();
  }
  if (gameOverAt !== null && gameOverAt <= now && !presenter.busy) {
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
  presenter.reset();
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
  if (presenter.busy || input.dragging) return;
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
  if (shopExitPending || presenter.busy || input.dragging) return;
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
      if (presenter.busy || !game.forceOutcome(outcome)) return false;
      presenter.reset();
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
  presenter.update(time, delta);
  updateScoring(time);
  sceneManager.update(delta);
  hand.animate(time, delta, input.selection);
  view.frame(cameraView.pivot.position, cameraView.structureRadius(), delta);
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
    presenter.dispose();
    hand.dispose();
    blockViews.disposeAll();
    field.dispose();
    passiveRackView.dispose();
    shopView.dispose();
    view.dispose();
  });
}
