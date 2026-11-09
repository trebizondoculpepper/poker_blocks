/**
 * Composition root. Allowed here: create the DOM host, construct services and the scene
 * manager, connect their narrow interfaces, open the selected mode, run the frame loop,
 * and dispose resources. Put rules and progression in the run controller; gestures in
 * table-input; presentation in view services and scene traits. Keep mode, phase and
 * scene decisions out of this file. See doc/game-architecture.md.
 */
import type { BlockDestroyerBoard } from "./scene-traits/dev-manual-block-destroyer";
import "./style.css";
import { createAudioService, type AudioService } from "./audio-service";
import { musicTracks } from "./audio/music-catalog";
import { createMusicController } from "./audio/music-controller";
import { createMusicPlayer } from "./audio/music-player";
import { playSfx, setSfxMuted, setSfxVolume } from "./audio/sfx";
import { createAttractBackground } from "./attract-scene";
import { createCameraViewService, type CameraViewService } from "./camera-view";
import { createConsoleHost } from "./console-host";
import type { SoundEffectId } from "./audio/sfx-registry";
import { createFieldView, type FieldView } from "./field-view";
import { createHandView, type HandView } from "./hand-view";
import { createHudPanels, type HudPanels } from "./hud-panels";
import { createOverlays, type Overlays } from "./overlays";
import { createPassiveRack } from "./passive-rack";
import { createPlayPresenter, type PlayPresenter } from "./play-presenter";
import { createBlockViews, type BlockViews } from "./rendered-blocks";
import { gameModeRegistry } from "./game-modes";
import { createRunController, type RunController } from "./run-controller";
import { browserStorage } from "./save";
import { SceneManager } from "./scenes";
import { sceneBehaviours } from "./scene-behaviours";
import { bindScreenshotShortcut } from "./screenshot";
import { createShopView, type ShopView } from "./shop-view";
import { createDiscardTarget, createTableInput, type TableInput } from "./table-input";
import { createTableRenderer, type TableRenderer } from "./table-renderer";
import { createHudFrame } from "./hud-frame";
import { appVersion } from "./version";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app element");
app.innerHTML = '<main class="scene" role="application" aria-label="Poker Blocks"></main>';
const host = app.querySelector<HTMLDivElement>(".scene")!;
const cubeSize = 2.4;

// ----- Services, in the order their elements stack on the page -----

const hud: HudPanels = createHudPanels(host);
const discardArea = createDiscardTarget(host);
const view: TableRenderer = createTableRenderer(host);
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
  cubeSize,
  onCenter: (center) => cameraView.updateRotationCenter(center),
});
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

// ----- Scenes: each trait composed into a scene installs its behaviour -----

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
    run: RunController;
    board: BlockDestroyerBoard;
    attract: { start(): void; stop(): void; showTuning(): void; hideTuning(): void };
    shop: ShopView;
    version: string;
    sound: (id: SoundEffectId) => void;
  };
};
const attract = createAttractBackground();
const traitContext: TraitContext = {
  host,
  services: {
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
    get shop() {
      return shopView;
    },
    sound: (id) => playSfx(id),
    version: appVersion,
  },
};
const sceneManager = new SceneManager(sceneBehaviours<TraitContext>(), traitContext);
for (const modeId of gameModeRegistry.names()) {
  for (const scene of gameModeRegistry.get(modeId).scenes) sceneManager.register(scene);
}

// ----- The run, and the services that show it -----

const storage = browserStorage();
const run: RunController = createRunController({
  host,
  storage,
  params: new URLSearchParams(window.location.search),
  scenes: sceneManager,
  services: {
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
  },
});
const passiveRackView = createPassiveRack(host, {
  capacity: run.mode.traits.passiveRack?.capacity,
  onPickUp: (block, event) => input.pickUpPassive(block, event),
});
passiveRackView.element.hidden = !run.mode.traits.passiveRack;
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
);
shopView.render([], false);
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
  cubeSize,
  setDragLayer: (cube, dragging) => view.setDragLayer(cube, dragging),
  onSelectionChange: () => run.showSelection(),
  routeToScenes: (event) => sceneManager.dispatch(event),
  rules: run.rules,
});
run.begin();
const overlays: Overlays = createOverlays(host, {
  settings: run.settings,
  audio,
  reducedMotion: () => run.reducedMotion,
  scenes: run.screenScenes,
  menus: run.menus,
});
// The shared HUD frame (#116): gameplay and the shop place their controls in its zones.
const hudFrame = createHudFrame(host);
hudFrame.place(overlays.menuButton, "top-right");

// ----- The start scene -----

run.open();
const unbindScreenshot = bindScreenshotShortcut(
  host,
  { back: view.renderer, front: view.front },
  render,
);
hud.onAction(() => run.takeNextAction());
// Developer console: ~ (or `) drops it down.
const devConsole = createConsoleHost(run.consoleApp, audio);
cameraView.start();

// ----- The frame loop -----

let frame = 0;
let lastTime = 0;
const animate = (time: number) => {
  const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
  lastTime = time;
  cameraView.update(time, delta);
  presenter.update(time, delta);
  presenter.updateScore(time);
  run.followOutcomes(time);
  field.update(time);
  sceneManager.update(delta);
  const background = attract.frame(delta);
  view.attract(background?.scene ?? null, background?.camera ?? null, delta);
  hand.animate(time, delta, input.selection);
  view.frame(cameraView.pivot.position, cameraView.structureRadius(), delta);
  input.frame();
  run.promptFirstPlay(time);
  passiveRackView.frame(time, run.reducedMotion);
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
    run.dispose();
    attract.dispose();
    presenter.dispose();
    hand.dispose();
    blockViews.disposeAll();
    field.dispose();
    passiveRackView.dispose();
    shopView.dispose();
    view.dispose();
  });
}
