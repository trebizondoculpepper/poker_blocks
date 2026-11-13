import { setContainedReducedMotion } from "./visual/contained";
import type { WordCubeRoom } from "./tools/word-cube-room";
import type { DialogRoom } from "./tools/dialog-room";
import type { TuningControl } from "./attract-tuning-panel";
import { createBlockTitles } from "./block-title-view";
import type { BlockTitles } from "./scene-traits/block-title";
/**
 * Composition root. Allowed here: create the DOM host, construct services and the scene
 * manager, connect their narrow interfaces, open the selected mode, run the frame loop,
 * and dispose resources. Put rules and progression in the run controller; gestures in
 * table-input; presentation in view services and scene traits. Keep mode, phase and
 * scene decisions out of this file. See doc/game-architecture.md.
 */
import { createActionLog, type ActionLog } from "./action-log";
import type { ActionWatch } from "./scene-traits/action-history";
import { createDanceFloor } from "./dance/dance-floor";
import { createBeatSignal } from "./audio/beat-signal";
import type { FirstPlayTable } from "./scene-traits/first-play-prompt";
import type { BlockDestroyerBoard } from "./scene-traits/dev-manual-block-destroyer";
import "./style.css";
import { createAudioService, type AudioService } from "./audio-service";
import { musicTracks } from "./audio/music-catalog";
import { createMusicController } from "./audio/music-controller";
import { createMusicPlayer } from "./audio/music-player";
import { playSfx, setSfxMuted, setSfxVolume } from "./audio/sfx";
import { createAttractBackground } from "./attract-scene";
import { createBackgroundLayers } from "./scene-layer";
import { createCameraViewService, type CameraViewService } from "./camera-view";
import { createConsoleHost } from "./console-host";
import type { SoundEffectId } from "./audio/sfx-registry";
import { createFieldView, type FieldView } from "./field-view";
import { createHandView, type HandView } from "./hand-view";
import { createHudPanels, type HudPanels } from "./hud-panels";
import { createDeckView, type DeckView } from "./deck-view";
import { createOverlays, type Overlays } from "./overlays";
import { createDialogPresenter } from "./block-menu/block-menus";
import { createPassiveRack } from "./passive-rack";
import { createPlayPresenter, type PlayPresenter } from "./play-presenter";
import { createBlockViews, type BlockViews } from "./rendered-blocks";
import { blockMenuMotion, gameModeRegistry } from "./game-modes";
import { createGameRunController, type GameRunController } from "./game-run-controller";
import { browserStorage } from "./save";
import { SceneManager } from "./scenes";
import { sceneBehaviours, type SceneHost } from "./scene-behaviours";
import { bindScreenshotShortcut } from "./screenshot";
import { createShopView, type ShopView } from "./shop-view";
import type { ShopBalanceEditor } from "./tools/shop-balance-editor";
import type { ProfilerRoom } from "./tools/profiler/room";
import { createRenderGate } from "./render-gate";
import type { CrystalComparisonRoom } from "./tools/crystal-comparison/room";
import { createBinView, type BinView } from "./bin-view";
import { createSelectionBadge, type SelectionBadge } from "./selection-badge";
import { createDiscardTarget, createTableInput, type TableInput } from "./table-input";
import { createTableRenderer, type TableRenderer } from "./table-renderer";
import { createHudFrame } from "./hud-frame";
import { gameplayHudZones, type HudElement } from "./hud-layout";
import { appVersion } from "./version";
import { createVisualScheduler } from "./visual-events/scheduler";
import type { ScoreNarrationServices } from "./score-narration";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app element");
app.innerHTML = '<main class="scene" role="application" aria-label="Poker Blocks"></main>';
const host = app.querySelector<HTMLDivElement>(".scene")!;
const cubeSize = 2.4;

// ----- Services, in the order their elements stack on the page -----

// Background traits mount their canvases here while their scenes are on the stack (#189).
const backgrounds = createBackgroundLayers(host);
const hud: HudPanels = createHudPanels(host);
const discardArea = createDiscardTarget(host);
const bin = createBinView(discardArea);
const selectionBadge = createSelectionBadge(host);
const view: TableRenderer = createTableRenderer(host, backgrounds);
const render = () => view.render(cameraView.camera, cameraView.handCamera);
const cameraView: CameraViewService = createCameraViewService({
  host,
  renderers: [view.renderer, view.front],
  scene: view.scene,
  cubeSize,
  getCells: () => field.cells(),
  getMassCenter: () => field.massCenter,
  layoutHand: () => hand.layout(),
  render,
});
const blockViews: BlockViews = createBlockViews({
  board: cameraView.assembly,
  hand: view.handScene,
});
const field: FieldView = createFieldView({
  views: blockViews,
  assembly: cameraView.assembly,
  world: view.scene,
  cubeSize,
  onCenter: (center) => cameraView.updateRotationCenter(center),
});
const musicPlayer = createMusicPlayer(musicTracks);
// Where the heard music is, as a phase visuals can follow (#255); presentation only.
// Interaction events and callbacks, recorded while a scene composes `actionHistory`.
const actionLog = createActionLog();
const beat = createBeatSignal(() => musicPlayer.position(performance.now()));
// Things that move with the music join the dance floor (#256). Reduced motion stills them.
const danceFloor = createDanceFloor(beat, () => run.reducedMotion);
// Contained blocks' drifting parts (a cloud, a field of stars) follow the reduced-motion setting.
setContainedReducedMotion(() => run.reducedMotion);
const audio: AudioService = createAudioService({
  player: musicPlayer,
  music: createMusicController(
    musicPlayer,
    musicTracks.map(({ id }) => id),
  ),
  sfx: { setVolume: setSfxVolume, setMuted: setSfxMuted, play: (id) => playSfx(id) },
  gestures: window,
});

// ----- Scenes: each trait composed into a scene installs its behaviour -----

type TraitContext = {
  host: HTMLElement;
  services: {
    bin: BinView;
    selectionBadge: SelectionBadge;
    renderer: TableRenderer;
    cameraView: CameraViewService;
    audio: AudioService;
    hud: HudPanels;
    overlays: Overlays;
    hand: HandView;
    field: FieldView;
    firstPlay: FirstPlayTable;
    actionLog: ActionLog;
    actionWatch: ActionWatch;
    presenter: PlayPresenter;
    input: TableInput;
    run: GameRunController;
    board: BlockDestroyerBoard;
    blockTitles: BlockTitles;
    attract: {
      start(): void;
      stop(): void;
      showTuning(controls?: readonly TuningControl[]): void;
      hideTuning(): void;
    };
    shop: ShopView;
    rack: { viewEntered(entered: boolean, capacity: number): void };
    deckView: DeckView;
    devShopBalanceEditor: ShopBalanceEditor;
    devObjectBrowser: ShopBalanceEditor;
    devBlockDesigner: ShopBalanceEditor;
    devContainedProof: ShopBalanceEditor;
    devProfiler: ProfilerRoom;
    devCrystalComparison: CrystalComparisonRoom;
    devWordCubeRoom: WordCubeRoom;
    dialogs: SceneHost["services"]["dialogs"];
    devDialogRoom: DialogRoom;
    version: string;
    sound: (id: SoundEffectId) => void;
  };
};
const attract = createAttractBackground(backgrounds);
const blockTitles = createBlockTitles(() => host, danceFloor);
const deckView = createDeckView(host);
// The developer tool has its own build boundary; production never imports its UI or data.
const devShopBalanceEditor: ShopBalanceEditor = import.meta.env.DEV
  ? (await import("./tools/shop-balance-editor")).createShopBalanceEditor(host)
  : { show() {}, hide() {}, dispose() {} };
const devBlockDesigner: ShopBalanceEditor = import.meta.env.DEV
  ? (await import("./tools/block-designer")).createBlockDesigner(host)
  : { show() {}, hide() {}, dispose() {} };
const devContainedProof: ShopBalanceEditor = import.meta.env.DEV
  ? (await import("./tools/contained-proof/room")).createContainedProofRoom(host)
  : { show() {}, hide() {}, dispose() {} };
// The frame loop's pause capability, for tools that need the GPU to themselves.
const renderGate = createRenderGate();
const devProfiler: ProfilerRoom = import.meta.env.DEV
  ? (await import("./tools/profiler/room")).createProfilerRoom(host, {
      pauseRendering: () => renderGate.pause(),
    })
  : {
      show() {},
      hide() {},
      dispose() {},
      orchestration: () => ({
        enter: async () => {},
        rerun: async () => {},
        exit: async () => {},
        generation: 0,
      }),
      onRunAll: () => () => {},
      showReport() {},
    };
const devCrystalComparison: CrystalComparisonRoom = import.meta.env.DEV
  ? (await import("./tools/crystal-comparison/room")).createCrystalComparisonRoom(host, {
      reducedMotion: () => run.reducedMotion,
    })
  : { show() {}, hide() {}, dispose() {} };
const devWordCubeRoom: WordCubeRoom = import.meta.env.DEV
  ? (await import("./tools/word-cube-room")).createWordCubeRoom(host)
  : { show() {}, hide() {}, dispose() {} };
// The game's dialogs as block menus, drawn in the title panel (#529); overlays are built later,
// so the host is looked up when the first dialog shows.
const dialogPresenter = createDialogPresenter(() => overlays.choicesHost(), {
  ...blockMenuMotion,
  floor: danceFloor,
});
const devDialogRoom: DialogRoom = import.meta.env.DEV
  ? (await import("./tools/dialog-room")).createDialogRoom(host, danceFloor)
  : { add: () => () => {}, show() {}, hide() {}, dispose() {} };
const devObjectBrowser: ShopBalanceEditor = import.meta.env.DEV
  ? (await import("./tools/object-browser")).createObjectBrowser(host)
  : { show() {}, hide() {}, dispose() {} };
const traitContext: TraitContext = {
  host,
  services: {
    bin,
    selectionBadge,
    renderer: view,
    cameraView,
    audio,
    hud,
    field,
    // Built below, once the services they depend on exist.
    get overlays() {
      return overlays;
    },
    get hand() {
      return hand;
    },
    get presenter() {
      return presenter;
    },
    get input() {
      return input;
    },
    get run() {
      return run;
    },
    board: {
      blockAt: (clientX, clientY) => input.fieldBlockAt(clientX, clientY),
      destroy: (blockId, cause) => run.destroyBlock(blockId, cause),
    },
    attract,
    blockTitles,
    // The action log records only while a scene composing `actionHistory` shows (dev10).
    actionLog,
    actionWatch: {
      state: () => ({
        animating: presenter.busy,
        presenting: presenter.presenting,
        dragging: input.dragging,
        modelBlocks: run.fieldCount(),
        drawnBlocks: field.cells().length,
      }),
      header: () => [
        ["version", appVersion],
        ["mode", new URLSearchParams(window.location.search).get("mode") ?? "game"],
        ["screen", `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`],
        ["scenes", sceneManager.stack.map(({ id }) => id).join(" > ")],
        ["userAgent", navigator.userAgent],
      ],
    },
    // What the first-play prompt trait asks of the table, the run and the input.
    firstPlay: {
      firstPlayCell: () => run.firstPlayCell(),
      fieldCount: () => run.fieldCount(),
      candidateCell: () => input.candidateCell,
      busy: () => input.dragging || presenter.busy,
      reducedMotion: () => run.reducedMotion,
      placeObject: (object, cell) => field.placeObject(object, cell),
      removeObject: (object) => field.removeObject(object),
      cubeSize,
      danceFloor,
    },
    get shop() {
      return shopView;
    },
    get rack() {
      return passiveRackView;
    },
    deckView,
    devShopBalanceEditor,
    devObjectBrowser,
    devBlockDesigner,
    devContainedProof,
    devProfiler,
    devCrystalComparison,
    devWordCubeRoom,
    // Every dialog a scene composes goes to the game's presenter and, in development, to the
    // dialog room (dev14), which shows only while its own scene does.
    dialogs: {
      add(dialog, handlers) {
        const removes = [dialogPresenter.add(dialog, handlers), devDialogRoom.add(dialog)];
        return () => removes.forEach((remove) => remove());
      },
    },
    devDialogRoom,
    sound: (id) => playSfx(id),
    version: appVersion,
  },
};
const sceneManager = new SceneManager(sceneBehaviours<TraitContext>(), traitContext);
for (const modeId of gameModeRegistry.names()) {
  for (const scene of gameModeRegistry.get(modeId).scenes) sceneManager.register(scene);
}

// ----- The run, and the services that show it -----

// The shared HUD frame (#116), over the back canvas; the run lays it out from settings (#119).
const hudFrame = createHudFrame(host);
const storage = browserStorage();
const run: GameRunController = createGameRunController({
  host,
  storage,
  params: new URLSearchParams(window.location.search),
  scenes: sceneManager,
  services: {
    selectionBadge,
    hud,
    audio,
    renderer: view,
    cameraView,
    views: blockViews,
    field,
    get hand() {
      return hand;
    },
    get presenter() {
      return presenter;
    },
    get input() {
      return input;
    },
    get overlays() {
      return overlays;
    },
    get rack() {
      return passiveRackView;
    },
    get shop() {
      return shopView;
    },
    frame: hudFrame,
  },
});
const passiveRackView = createPassiveRack(host);
const hand: HandView = createHandView({
  views: blockViews,
  scene: view.handScene,
  cubeSize,
  baseY: () => cameraView.handBaseY,
  handSize: () => run.game.dealer.handSize,
  reducedMotion: () => run.reducedMotion,
  drag: () => input.handDrag(),
  onLayout: () => run.showSelection(),
});
run.seedTable();
const shopView = createShopView(
  host,
  passiveRackView.element,
  (offer) => run.offerPrice(offer),
  (id, destination) => run.buy(id, destination),
  () => cameraView.finishShopEntrance(),
  () => run.deckBlocks().length,
  () => run.reducedMotion,
  (id, destination) => run.game.purchaseVerdict(id, destination),
);
shopView.render([], false);
// The one shared visual-event scheduler (#546, #547). Its handlers reach presentation through
// these services; the frame loop below advances its clock.
const visualServices: ScoreNarrationServices = {
  get scoreNarration() {
    return presenter.narration;
  },
};
const visualEvents = createVisualScheduler({ services: visualServices });
const presenter: PlayPresenter = createPlayPresenter({
  game: () => run.game,
  views: blockViews,
  hand,
  field,
  cameraView,
  scene: view.scene,
  assembly: cameraView.assembly,
  reducedMotion: () => run.reducedMotion,
  deselect: (ids) => input.deselect(ids),
  changed: () => run.updateHud(),
  moved: () => run.showSelection(),
  rackChanged: () => run.rackChanged(),
  activated: (sourceIds) => sourceIds.forEach((id) => passiveRackView.activate(id)),
  refill: () => run.refillHand(),
  save: () => run.autosave(),
  decided: (outcome, now) => run.decided(outcome, now),
  visualEvents,
});
const input: TableInput = createTableInput({
  host,
  canvas: view.renderer.domElement,
  discardArea,
  cameraView,
  hand,
  field,
  overlays: () => overlays,
  audio,
  rack: passiveRackView,
  bin,
  handShown: () => view.handShown(),
  cubeSize,
  setDragLayer: (cube, dragging) => view.setDragLayer(cube, dragging),
  onSelectionChange: () => run.showSelection(),
  routeToScenes: (event) => sceneManager.dispatch(event),
  trace: (event, detail) => actionLog.record("input", event, detail),
  rules: run.rules,
});
// The shop's stock drags like everything else (#277); its shopStock trait enables it.
input.registerDragSource("shop", shopView.dragSource);
run.begin();
const overlays: Overlays = createOverlays(host, {
  settings: run.settings,
  reducedMotion: () => run.reducedMotion,
  scenes: run.screenScenes,
  menus: run.menus,
  // A won or lost stage waits while the deck view is open, like a menu (#175).
  panels: [deckView],
});
// Each HUD element goes in its zone of the shared frame (src/hud-layout.ts, #117).
const hudElements: Record<HudElement, HTMLElement> = {
  round: hud.element("round"),
  deck: hud.element("deck"),
  coins: hud.element("coins"),
  shopExit: hud.element("shopExit"),
  shopBuy: shopView.buyTarget,
  discard: discardArea,
  menu: overlays.menuButton,
};
for (const { element, zone } of gameplayHudZones) hudFrame.place(hudElements[element], zone);

// ----- The start scene -----

run.open();
const unbindScreenshot = bindScreenshotShortcut(
  host,
  { back: view.renderer, front: view.front },
  render,
);
hud.onAction(() => run.takeNextAction());
hud.onOpen((action) => run.dispatch(action));
// Developer console: ~ (or `) drops it down.
const devConsole = createConsoleHost(run.consoleApp, audio);
cameraView.start();

// ----- The frame loop -----

let frame = 0;
let lastTime = 0;
// One frame's updates and render; the render gate runs it only while no tool holds the GPU.
const step = (time: number) => {
  const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
  lastTime = time;
  actionLog.tick();
  beat.update(delta);
  danceFloor.update();
  cameraView.update(time, delta);
  presenter.update(time, delta);
  visualEvents.update(time, document.visibilityState === "visible");
  run.followOutcomes(time);
  field.update(time, run.reducedMotion);
  sceneManager.update(delta);
  attract.frame(delta);
  blockTitles.frame();
  hand.animate(time, delta, input.selection);
  view.frame(cameraView.pivot.position, cameraView.structureRadius(), delta);
  input.frame();
  passiveRackView.frame(time, run.reducedMotion);
  shopView.frame();
  render();
};
const animate = (time: number) => {
  renderGate.run(time, step);
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
    run.dispose();
    attract.dispose();
    blockTitles.dispose();
    presenter.dispose();
    hand.dispose();
    blockViews.disposeAll();
    field.dispose();
    passiveRackView.dispose();
    shopView.dispose();
    devShopBalanceEditor.dispose();
    devObjectBrowser.dispose();
    devBlockDesigner.dispose();
    devContainedProof.dispose();
    devProfiler.dispose();
    devCrystalComparison.dispose();
    devWordCubeRoom.dispose();
    devDialogRoom.dispose();
    dialogPresenter.dispose();
    view.dispose();
  });
}
