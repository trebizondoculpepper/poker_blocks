import {
  createPlacementPhase,
  placementProducer,
  scoringProducer,
  type PlacementPhase,
} from "./placement-phase";
import { createStageScoreGraph, type StageScoreGraph } from "./stage-score-graph";
import { triggeredProducer, type TriggeredEffectServices } from "./triggered-presentation";
import { createDazzle } from "./visual/dazzle";
import { cosmeticRandom } from "./visual/block-effects";
import { createActionPhases } from "./visual-events/action-phases";
import type { TransitionAudioServices } from "./scene-traits/material-change-sounds";
import type { MaterialTransitionServices } from "./material-transitions";
import type { ShopBurnServices, ShopExitScheduler } from "./scene-traits/shop-leave-response";
import {
  createRockingRelay,
  rockingResumeHandler,
  type PlayfieldRockingServices,
  type RockingSink,
} from "./playfield-rocking";
import { fieldMass } from "./field-mass";
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
import {
  createFieldLineAnchors,
  lineScoreLabel,
  type FieldLineServices,
} from "./field-line-labels";
import { createHandView, type HandView } from "./hand-view";
import { createHudPanels, type HudPanels } from "./hud-panels";
// Registers the word-cube HUD action presenter (#780).
import "./block-menu/hud-word-cube";
import { createDeckView, type DeckView } from "./deck-view";
import { createOverlays, type Overlays } from "./overlays";
import { createDialogPresenter } from "./block-menu/block-menus";
import { createPresentationClock, type PresentationClock } from "./presentation-clock";
import { createPassiveRack, type RackLabelServices } from "./passive-rack";
import {
  createPlayPresenter,
  type PlayPresenter,
  type PresentedActionServices,
} from "./play-presenter";
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
import type { FlameBenchRoom } from "./tools/flame-bench/room";
import { createBinView, type BinView } from "./bin-view";
import { registerBinControlPresenter } from "./bin-control-presenter";
import { createControlGroup } from "./block-menu/control-group";
import { createSelectionBadge, type SelectionBadge } from "./selection-badge";
import { createDiscardTarget, createTableInput, type TableInput } from "./table-input";
import { createTableRenderer, type TableRenderer } from "./table-renderer";
import { createHudFrame } from "./hud-frame";
import { gameplayHudZones, type HudElement } from "./hud-layout";
import { createDropTargetGuide, dropGuideProviders } from "./visual/drop-target-guide";
import type { DropTargetGuides } from "./scene-traits/drop-target-guide";
import { appVersion } from "./version";
import { createVisualScheduler, unitMs } from "./visual-events/scheduler";
import { createResistanceFeedbackController, survivorProducer } from "./resistance-feedback";
import type { ScoreNarrationServices } from "./score-narration";
import type { RewardLedgerServices } from "./reward-ledger";
import {
  createActivationLabelLayer,
  type ActivationLabelServices,
} from "./visual/activation-labels";
import { createDiagnosticRegistry } from "./diagnostics/debug-snapshot";
import { registerSnapshotProviders, snapshotSections } from "./diagnostics/providers";
import { debugSnapshotCommand } from "./diagnostics/snapshot-command";
import { registerConsoleCommand } from "./console/commands";
// Every exit effect registered, so a removed block's recipe can run (#511 review, #1173).
import { createExitPresenter } from "./visual/exit-effects";
import type { BlockExitServices, ExitPresenter } from "./visual/exit-presentation";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app element");
app.innerHTML = '<main class="scene" role="application" aria-label="Poker Blocks"></main>';
const host = app.querySelector<HTMLDivElement>(".scene")!;
const cubeSize = 2.4;

// ----- Services, in the order their elements stack on the page -----

// Background traits mount their canvases here while their scenes are on the stack (#189).
const backgrounds = createBackgroundLayers(host);
// HUD actions can be word cubes (#780), moving as block menu cubes do.
const hud: HudPanels = createHudPanels(host, blockMenuMotion);
const discardArea = createDiscardTarget(host);
const bin = createBinView(discardArea);
const selectionBadge = createSelectionBadge(host);
const view: TableRenderer = createTableRenderer(host, backgrounds);
const render = () => view.render(cameraView.camera, cameraView.handCamera);
// The playfield rocking resume relay (#783): the scheduler's handler reaches the controller here.
const rockingRelay = createRockingRelay();
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
const blockViews: BlockViews = createBlockViews(
  { board: cameraView.assembly, hand: view.handScene },
  view.prepasses,
);
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
    presentationClock: PresentationClock;
    bin: BinView;
    selectionBadge: SelectionBadge;
    renderer: TableRenderer;
    cameraView: CameraViewService;
    playfieldRocking: PlayfieldRockingServices;
    scoreGraph: StageScoreGraph;
    visualEvents: ShopExitScheduler;
    audio: AudioService;
    hud: HudPanels;
    overlays: Overlays;
    hand: HandView;
    field: FieldView;
    exits: ExitPresenter;
    actionPhase: PlacementPhase;
    composeProducer(producer: string): () => void;
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
    dropTargetGuides: DropTargetGuides;
    rack: { viewEntered(entered: boolean, capacity: number): void };
    deckView: DeckView;
    devShopBalanceEditor: ShopBalanceEditor;
    devObjectBrowser: ShopBalanceEditor;
    devBlockDesigner: ShopBalanceEditor;
    devContainedProof: ShopBalanceEditor;
    devProfiler: ProfilerRoom;
    devCrystalComparison: CrystalComparisonRoom;
    devFlameBench: FlameBenchRoom;
    devWordCubeRoom: WordCubeRoom;
    devEffectAudition: { show(config: { hint: string }): void; hide(): void; dispose(): void };
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
const devFlameBench: FlameBenchRoom = import.meta.env.DEV
  ? (await import("./tools/flame-bench/room")).createFlameBenchRoom(host, {
      reducedMotion: () => run.reducedMotion,
    })
  : { show() {}, hide() {}, dispose() {} };
const devEffectAudition = import.meta.env.DEV
  ? (await import("./tools/effect-audition")).createEffectAuditionNote(host)
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
  ? (await import("./tools/object-browser")).createObjectBrowser(host, () => run.reducedMotion)
  : { show() {}, hide() {}, dispose() {} };
const presentationClock = createPresentationClock();
const traitContext: TraitContext = {
  host,
  services: {
    presentationClock,
    bin,
    selectionBadge,
    renderer: view,
    cameraView,
    get visualEvents() {
      return visualEvents;
    },
    // The shared block-exit presenter (#1173), built with the scheduler below.
    get exits() {
      return exitPresenter;
    },
    get actionPhase() {
      return placementPhase;
    },
    composeProducer: (producer) => actionPhases.compose(producer),
    // The stage score graph a stage scene composes (#1064), built with the run below.
    get scoreGraph() {
      return scoreGraph;
    },
    // The rocking controller's capabilities (#783): wiring only, no policy.
    playfieldRocking: {
      setRate: (rate) => cameraView.setMotionRate(rate),
      nowMs: () => visualEvents.nowMs,
      scheduleResume(generation, units) {
        const scope = visualEvents.createScope(null);
        visualEvents.schedule(scope, {
          handler: rockingResumeHandler,
          payload: { generation },
          dueUnits: visualEvents.nowMs / unitMs + units,
        });
        visualEvents.seal(scope);
        return () => visualEvents.cancel(scope);
      },
      observeBoardTurn: (listener) => input.observeBoardTurn(listener),
      observeCarry: (listener) => input.observeCarry(listener),
      onCommitted: (listener) => run.onCommitted(() => listener()),
      fieldMassKg() {
        const mass = fieldMass(run.committedState());
        return "unavailable" in mass || mass.count === 0 ? null : mass.totalKg;
      },
      reducedMotion: () => run.reducedMotion,
      relay: rockingRelay,
    },
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
    // Drag target guides over the page host, following the input's drag lifecycle (#922, #924).
    dropTargetGuides: {
      create: (config) =>
        createDropTargetGuide(config, {
          element: host,
          observeDrag: (listener) => input.observeDrag(listener),
        }),
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
    devFlameBench,
    devWordCubeRoom,
    devEffectAudition,
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
// The real-trigger fixture's Dev material (#1177), installed only in development.
await (import.meta.env.DEV
  ? import("./tools/trigger-fixture/fixture").then((fixture) => fixture.installTriggerFixture())
  : Promise.resolve());
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
// The shop's controls (Buy, Sell) share one control-stage host over the scene (#1078).
const controlOverlay = document.createElement("div");
host.append(controlOverlay);
const shopControls = createControlGroup(controlOverlay, () => run.reducedMotion);
registerBinControlPresenter(shopControls);
const shopView = createShopView(
  host,
  passiveRackView.element,
  (offer) => run.offerPrice(offer),
  (id, destination) => run.buy(id, destination),
  () => cameraView.finishShopEntrance(),
  () => run.deckBlocks().length,
  () => run.reducedMotion,
  (id, destination) => run.game.purchaseVerdict(id, destination),
  { floor: danceFloor, controls: shopControls },
);
shopView.render([], false);
// Triggered explosions' pops (#1172): one dazzle over the table, seen through its camera.
const dazzle = createDazzle(host, cameraView.camera, {
  random: cosmeticRandom,
  reducedMotion: () => run.reducedMotion,
});
// The one shared visual-event scheduler (#546, #547). Its handlers reach presentation through
// these services; the frame loop below advances its clock.
const visualServices: ScoreNarrationServices &
  ActivationLabelServices &
  RackLabelServices &
  PresentedActionServices &
  RewardLedgerServices &
  ShopBurnServices &
  BlockExitServices &
  TransitionAudioServices &
  MaterialTransitionServices &
  FieldLineServices &
  TriggeredEffectServices & { playfieldRocking: RockingSink } = {
  get scoreNarration() {
    return presenter.narration;
  },
  // Plays' flights and discards' dissolves (#548).
  get presentedActions() {
    return presenter.presentedActions;
  },
  // The stage-won ledger's count-up (#950).
  get rewardLedger() {
    return overlays.rewardLedger;
  },
  // Item activation labels beside the rack (#919), drawn over the same host the rack is in.
  activationLabels: createActivationLabelLayer(host),
  passiveRack: passiveRackView,
  // Scored lines' projected bounds, for their fitted score labels (#1158).
  fieldLines: createFieldLineAnchors({
    cubes: () => field.blocks().map(({ block, cube }) => ({ id: block.id, object: cube })),
    camera: () => cameraView.camera,
    canvas: view.renderer.domElement,
    host,
  }),
  // Where a scheduled rocking resume reaches the playfield controller (#783).
  playfieldRocking: rockingRelay,
  // A committed material transition's sound (#539).
  transitionAudio: { play: (id) => playSfx(id) },
  // ...and its look (#1167): the table block, and a detached view of its captured old card.
  materialTransitions: {
    block: (blockId) => field.blocks().find(({ block }) => block.id === blockId) ?? null,
    detachedView(block) {
      const made = blockViews.create(block, cubeSize, "board");
      blockViews.transfer(made);
      return made;
    },
    release: (view) => blockViews.dispose(view),
    reducedMotion: () => run.reducedMotion,
    diagnose: (message) => console.warn(message),
  },
  // Block exits on this scheduler (#549, #1173).
  get blockExits() {
    return exitPresenter.blockExits;
  },
  // The shop's outgoing burn, advanced on this scheduler (#880).
  shopBurn: { effect: (startMs) => shopView.burnEffect(startMs) },
  // Triggered effects at their captured cells, moving with the board (#1172).
  triggeredEffects: {
    place: (object, cell) => field.placeObject(object, cell),
    remove: (object) => field.removeObject(object),
    addToWorld: (object) => view.scene.add(object),
    removeFromWorld: (object) => view.scene.remove(object),
    get cubeSize() {
      return field.cubeSize;
    },
    flash: (at, look) => dazzle.flash(at, { look }),
    reducedMotion: () => run.reducedMotion,
    random: cosmeticRandom,
  },
};
const visualEvents = createVisualScheduler({ services: visualServices });
// Removed blocks' exits (#1173), presented on that scheduler.
const exitPresenter = createExitPresenter(visualEvents, () => run.reducedMotion);
// Hidden time never counts as presentation time, even when the browser stops sending frames.
document.addEventListener("visibilitychange", () => visualEvents.suspend());
// Committed actions' presentation records (#1218): a play's flight binds to its own action (#1219).
const actionPhases = createActionPhases(visualEvents, {
  plan: "scoring",
  producers: [placementProducer, scoringProducer, triggeredProducer, survivorProducer],
});
const placementPhase = createPlacementPhase(run, actionPhases);
// The stage score graph (#1064): hung in the room (never the turning assembly), its producer
// composed only while a scene shows it.
const scoreGraph = createStageScoreGraph({
  source: run,
  history: () => run.committedState().round.history,
  phase: placementPhase,
  compose: (producer) => actionPhases.compose(producer),
  room: view.scene,
  host,
  scheduler: visualEvents,
  reducedMotion: () => run.reducedMotion,
});
// A blast's survivors answer in place with their declared feedback, after scoring (#1174).
const survivorFeedback = createResistanceFeedbackController({
  source: run,
  phase: placementPhase,
  mount: (blockId) => field.blocks().find(({ block }) => block.id === blockId)?.cube ?? null,
  reducedMotion: () => run.reducedMotion,
});
const presenter: PlayPresenter = createPlayPresenter({
  runScoped: [survivorFeedback],
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
  alongside: (activation) => passiveRackView.labelFor(activation),
  lineAlongside: (line, settleUnits) => lineScoreLabel(line, settleUnits),
  drawReplacements: () => run.drawReplacements(),
  save: () => run.autosave(),
  decided: (outcome, now, occurrence) => run.decided(outcome, now, occurrence),
  visualEvents,
  placementPhase,
  committed: run,
  // A reset takes the explosions' glare and afterimages with it (#1294 review).
  resetFeedback: () => dazzle.clear(),
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
// What the shop scene's drag guide points to (#924), named by its `dropTargetGuide` trait.
dropGuideProviders.register("shopOffers", shopView.guideProvider);
run.begin();
const overlays: Overlays = createOverlays(host, {
  settings: run.settings,
  reducedMotion: () => run.reducedMotion,
  scenes: run.screenScenes,
  menus: run.menus,
  // A won or lost stage waits while the deck view is open, like a menu (#175).
  panels: [deckView],
  visualEvents,
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
// The debug snapshot (#987): development builds only (doc/debug-snapshot.md). A production build
// composes neither its providers nor its command. The scheduler section stays `unavailable`
// until the running game owns a visual scheduler (#547).
const leaveDiagnostics = import.meta.env.DEV
  ? (() => {
      const diagnostics = createDiagnosticRegistry(snapshotSections);
      const leaveProviders = registerSnapshotProviders(diagnostics, {
        version: appVersion,
        mode: () => run.consoleApp.mode().id,
        sceneStack: () => sceneManager.stack.map(({ id }) => id),
        state: () => run.consoleApp.game().state,
        titles: () => blockTitles.mounted(),
        actions: () => ({ recording: actionLog.recording, entries: actionLog.entries() }),
      });
      const leaveCommand = registerConsoleCommand(
        debugSnapshotCommand(() => diagnostics.snapshot()),
      );
      return () => {
        leaveCommand();
        leaveProviders();
      };
    })()
  : () => {};
const devConsole = createConsoleHost(run.consoleApp, audio);
cameraView.start();

// ----- The frame loop -----

let frame = 0;
let lastTime = 0;
// One frame's updates and render; the render gate runs it only while no tool holds the GPU.
const step = (time: number) => {
  const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
  lastTime = time;
  // The playfield draws on the presentation clock, which a pausing scene holds still (#530).
  const playfield = presentationClock.advance(time, delta);
  actionLog.tick();
  beat.update(delta);
  danceFloor.update();
  cameraView.update(playfield.time, playfield.delta);
  presenter.update(time, delta);
  visualEvents.update(time, document.visibilityState === "visible");
  scoreGraph.frame();
  dazzle.update(delta);
  run.followOutcomes(time);
  field.update(playfield.time, run.reducedMotion);
  sceneManager.update(delta);
  attract.frame(delta);
  blockTitles.frame();
  hand.animate(playfield.time, playfield.delta, input.selection);
  view.frame(cameraView.pivot.position, cameraView.structureRadius(), playfield.delta);
  input.frame();
  passiveRackView.frame(playfield.time, run.reducedMotion);
  shopView.frame(delta);
  render();
};
const animate = (time: number) => {
  renderGate.run(time, step);
  frame = requestAnimationFrame(animate);
};
frame = requestAnimationFrame(animate);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    survivorFeedback.dispose();
    // The shop's shared control stage and its overlay (#1298).
    shopControls.dispose();
    controlOverlay.remove();
    unbindScreenshot();
    cancelAnimationFrame(frame);
    cameraView.dispose();
    input.dispose();
    audio.dispose();
    hud.dispose();
    devConsole.dispose();
    leaveDiagnostics();
    overlays.dispose();
    run.dispose();
    attract.dispose();
    blockTitles.dispose();
    presenter.dispose();
    dazzle.dispose();
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
    devFlameBench.dispose();
    devWordCubeRoom.dispose();
    devEffectAudition.dispose();
    devDialogRoom.dispose();
    dialogPresenter.dispose();
    view.dispose();
  });
}
