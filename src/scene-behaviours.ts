import { beatShapes } from "./dance/beat-shapes";
import { danceCycles } from "./dance/dance-floor";
import type { TuningControl } from "./attract-tuning-panel";
import { blockTitle, type BlockTitles } from "./scene-traits/block-title";
/**
 * The behaviour each scene trait installs (see doc/game-architecture.md, "Trait").
 * `screen` marks the host with the scene in front, for styling and tests; `pausesBelow`
 * stops the scenes underneath a pop-up or menu taking input or updates; the HUD panel traits
 * show and hide one panel each; `dropTarget` and `dragSource` allow drops and pick-ups;
 * `shopStock` shows and hides the shop's stock; `gameOverScreen` shows the run's totals and
 * choices; `musicCue` plays a music cue on entering; `devManualBlockDestroyer` (testing only)
 * destroys a double-clicked table block.
 *
 * Each trait brings its own behaviour, so a scene composes the panels and permissions it
 * wants and nothing has to ask which scene is in front.
 */
import type { SelectionBadge } from "./selection-badge";
import type { BinView } from "./bin-view";
import { devDropInspector } from "./scene-traits/dev-drop-inspector";
import { actionHistory, type ActionWatch } from "./scene-traits/action-history";
import type { ActionLog } from "./action-log";
import { firstPlayPrompt, type FirstPlayTable } from "./scene-traits/first-play-prompt";
import type { MenuCondition, MenuItem, SceneTraits } from "./game-modes";
import type { DialogHandlers } from "./block-menu/block-menus";
import type { AudioService } from "./audio-service";
import type { CameraViewService } from "./camera-view";
import type { Overlays } from "./overlays";
import type { HudPanel, HudPanelConfigs, HudPanels } from "./hud-panels";
import type { GameRunController } from "./game-run-controller";
import type { ShopView } from "./shop-view";
import type { TableInput } from "./table-input";
import type { TableRenderer } from "./table-renderer";
import {
  devManualBlockDestroyer,
  type BlockDestroyerBoard,
} from "./scene-traits/dev-manual-block-destroyer";
import { SceneTraitRegistry } from "./scenes";
import type { DeckView } from "./deck-view";
import type { ShopBalanceEditor } from "./tools/shop-balance-editor";
import { devHudStyleAudition, hudStyle } from "./scene-traits/hud-style";
import type { SoundEffectId } from "./audio/sfx-registry";

/** What a scene trait's behaviour may touch. */
export type SceneHost = {
  host: HTMLElement;
  services: {
    board: BlockDestroyerBoard;
    /** The field, for the first-play prompt a play scene shows. */
    firstPlay: FirstPlayTable;
    /** The action log and what it watches, for the action history and the drop inspector. */
    actionLog: ActionLog;
    actionWatch: ActionWatch;
    /** The title's attract sequence: started and stopped by a scene trait (#147). */
    blockTitles: Pick<BlockTitles, "show" | "tuning" | "retune">;
    attract: {
      start(): void;
      stop(): void;
      showTuning(controls?: readonly TuningControl[]): void;
      hideTuning(): void;
    };
    /** Whether the room and table are drawn while a scene composing `tableBackground` is in front. */
    renderer: Pick<TableRenderer, "tableEntered" | "handEntered">;
    hud: Pick<HudPanels, "show" | "hide">;
    /** The bin: shown while a scene composing `discardBin` or `sellBin` is on the stack (#278). */
    bin: Pick<BinView, "discardBinEntered" | "sellBinEntered">;
    /** The selection badge shows only while the hand does (#305). */
    selectionBadge: Pick<SelectionBadge, "handEntered">;
    input: Pick<
      TableInput,
      | "cancelGestures"
      | "enableDropTarget"
      | "enableDragSource"
      | "enableSelectSource"
      | "enableBoardGestures"
    >;
    shop: ShopView;
    /** The passive rack, shown while a scene composing `passiveRackView` is on the stack. */
    rack: { viewEntered(entered: boolean, capacity: number): void };
    /** The read-only deck view (#175). */
    deckView: Pick<DeckView, "show" | "hide">;
    devShopBalanceEditor: Pick<ShopBalanceEditor, "show" | "hide">;
    devObjectBrowser: Pick<ShopBalanceEditor, "show" | "hide">;
    devBlockDesigner: Pick<ShopBalanceEditor, "show" | "hide">;
    devContainedProof: Pick<ShopBalanceEditor, "show" | "hide">;
    devProfiler: {
      show(config: SceneTraits["devProfiler"]): void;
      hide(): void;
      /** A run scope over the room's narrow capabilities (#732): the trait drives it. */
      orchestration(): {
        enter(config: SceneTraits["devProfiler"]): Promise<void>;
        rerun(): Promise<void>;
        exit(): Promise<void>;
      };
      onRunAll(listener: () => void): () => void;
    };
    devCrystalComparison: {
      show(config: SceneTraits["devCrystalComparison"]): void;
      hide(): void;
    };
    devWordCubeRoom: {
      show(config: SceneTraits["devWordCubeRoom"]): void;
      hide(): void;
    };
    /**
     * Shows the dialogs scenes compose; each `add` returns a function that takes it away. The
     * handlers route its choices and give each one's availability (#529).
     */
    dialogs: { add(config: SceneTraits["titleMenuDialog"], handlers: DialogHandlers): () => void };
    devDialogRoom: {
      show(config: SceneTraits["devDialogRoom"]): void;
      hide(): void;
    };
    /** The run, for the game state a scene trait presents and the actions it dispatches. */
    run: Pick<
      GameRunController,
      | "rackCapacity"
      | "shopStock"
      | "deckBlocks"
      | "dispatch"
      | "hasSave"
      | "runStats"
      | "seed"
      | "reducedMotion"
      | "stageReward"
    >;
    cameraView: Pick<CameraViewService, "beginShopEntrance">;
    overlays: Pick<
      Overlays,
      | "showMenu"
      | "hideMenu"
      | "showSettings"
      | "hideSettings"
      | "showTitle"
      | "choose"
      | "hideTitle"
      | "showGameOver"
      | "hideGameOver"
      | "showStageWon"
      | "hideStageWon"
      | "showPanelFooter"
      | "hidePanelFooter"
    >;
    /** The build's version, shown in a panel's footer (`src/version.ts`). */
    version: string;
    audio: Pick<AudioService, "setMusicFilter" | "playStageMusic" | "playCue">;
    /** Play a registered sound effect (src/audio/sfx.ts). */
    sound(id: SoundEffectId): void;
  };
};

/** The scene input a `keyAction` trait reacts to, by event type. */
const keyEvents: Record<string, (event: KeyboardEvent, key: string) => boolean> = {
  // One press, one action: a held key's auto-repeat would open and close a menu over and over.
  keydown: (event, key) => event.key === key && !event.repeat,
};

export function sceneBehaviours<Context extends SceneHost>(): SceneTraitRegistry<
  SceneTraits,
  Context
> {
  const behaviours = new SceneTraitRegistry<SceneTraits, Context>();
  // How many entered scenes compose `runInPlay`: a run is in play while any of them is on the
  // stack (a menu pushed over a stage leaves it entered). No scene is identified by name.
  let runScenes = 0;
  /** Each menu condition's test: an item naming one is shown only while it holds. */
  const menuConditions: Record<MenuCondition, (context: Context) => boolean> = {
    inRun: () => runScenes > 0,
    hasSave: (context) => context.services.run.hasSave(),
  };
  /**
   * The items a menu shows: those whose `when` holds right now. An item whose `enabledWhen`
   * fails stays, disabled, carrying its hint.
   */
  const itemsToShow = (
    context: Context,
    items: readonly MenuItem[],
  ): (MenuItem & { disabled: boolean })[] =>
    items
      .filter(({ when }) => !when || menuConditions[when](context))
      .map((item) => ({
        ...item,
        disabled: Boolean(item.enabledWhen) && !menuConditions[item.enabledWhen!](context),
      }));
  behaviours.register("runInPlay", {
    enter() {
      runScenes++;
    },
    exit() {
      runScenes = Math.max(0, runScenes - 1);
    },
  });
  behaviours.register("screen", {
    enter(context, { kind }) {
      context.host.dataset.scene = kind;
    },
    exit(context, { kind }) {
      if (context.host.dataset.scene === kind) delete context.host.dataset.scene;
    },
    // Back in front after a pushed scene popped, whose exit cleared the marker.
    resume(context, { kind }) {
      context.host.dataset.scene = kind;
    },
  });
  behaviours.register("roundPanel", panel<Context, "round">("round"));
  behaviours.register("deckPanel", panel<Context, "deck">("deck"));
  behaviours.register("coinsPanel", panel<Context, "coins">("coins"));
  behaviours.register("shopExit", panel<Context, "shopExit">("shopExit"));
  // The shop's stock is shown, and its offers can be dragged to BUY (#277), while it's in front.
  const stockSources = new WeakMap<object, () => void>();
  behaviours.register("shopStock", {
    enter({ services }, config) {
      services.shop.render(services.run.shopStock(), true);
      stockSources.set(config, services.input.enableDragSource({ source: config.source }));
    },
    exit({ services }, config) {
      services.shop.render([], false);
      stockSources.get(config)?.();
      stockSources.delete(config);
    },
  });
  behaviours.register("blockTitle", blockTitle<Context>());
  behaviours.register("attractBackground", {
    // Start the attract sequence as the scene enters; stop it on exit so the table is the only
    // thing drawn during play (#147).
    enter: ({ services }) => services.attract.start(),
    exit: ({ services }) => services.attract.stop(),
  });
  behaviours.register("tableBackground", {
    // The room and table are drawn while any scene composing this is on the stack, so the
    // title (#147) and anything else that does not want a table simply omits it.
    enter: ({ services }) => services.renderer.tableEntered(true),
    exit: ({ services }) => services.renderer.tableEntered(false),
  });
  // The hand and the discard bin, like the table, exist while a scene that wants them is on the
  // stack (#183): a menu pushed over a stage leaves them, and the title composes neither.
  behaviours.register("handView", {
    // Drawn and reachable together: the input reaches hand blocks only while the renderer shows them.
    enter({ services }) {
      services.renderer.handEntered(true);
      services.selectionBadge.handEntered(true);
    },
    exit({ services }) {
      services.renderer.handEntered(false);
      services.selectionBadge.handEntered(false);
    },
  });
  behaviours.register("firstPlayPrompt", firstPlayPrompt<Context>());
  // While a scene shows, the drop targets its `dropTarget` data names are allowed (#273).
  const targetsEnabled = new WeakMap<object, (() => void)[]>();
  behaviours.register("dropTarget", {
    enter({ services }, config) {
      targetsEnabled.set(
        config,
        config.targets.map((target) => services.input.enableDropTarget(target)),
      );
    },
    exit(_context, config) {
      targetsEnabled.get(config)?.forEach((disable) => disable());
      targetsEnabled.delete(config);
    },
  });
  // While a scene shows, the drag sources its `dragSource` data names are allowed (#282).
  const sourcesEnabled = new WeakMap<object, (() => void)[]>();
  behaviours.register("dragSource", {
    enter({ services }, config) {
      sourcesEnabled.set(
        config,
        config.sources.map((source) => services.input.enableDragSource(source)),
      );
    },
    exit(_context, config) {
      sourcesEnabled.get(config)?.forEach((disable) => disable());
      sourcesEnabled.delete(config);
    },
  });
  // While a scene shows, the board's gestures are bound (#275).
  const gesturesBound = new WeakMap<object, () => void>();
  behaviours.register("boardGestures", {
    // The controller: the input service reports a turn starting; this trait's configuration says
    // which sound it plays (#641).
    enter({ services }, config) {
      gesturesBound.set(
        config,
        services.input.enableBoardGestures({ turnStarted: () => services.sound(config.turnSound) }),
      );
    },
    exit(_context, config) {
      gesturesBound.get(config)?.();
      gesturesBound.delete(config);
    },
  });
  const rackSources = new WeakMap<object, () => void>();
  // While a scene shows, a click selects from the sources its `selectable` data names (#276).
  const selectEnabled = new WeakMap<object, (() => void)[]>();
  behaviours.register("selectable", {
    enter({ services }, config) {
      selectEnabled.set(
        config,
        config.sources.map((source) => services.input.enableSelectSource(source)),
      );
    },
    exit(_context, config) {
      selectEnabled.get(config)?.forEach((disable) => disable());
      selectEnabled.delete(config);
    },
  });
  behaviours.register("passiveRackView", {
    enter({ services }, config) {
      services.rack.viewEntered(true, services.run.rackCapacity());
      rackSources.set(config, services.input.enableDragSource({ source: config.source }));
    },
    exit({ services }, config) {
      services.rack.viewEntered(false, services.run.rackCapacity());
      rackSources.get(config)?.();
      rackSources.delete(config);
    },
  });
  behaviours.register("discardBin", {
    enter: ({ services }) => services.bin.discardBinEntered(true),
    exit: ({ services }) => services.bin.discardBinEntered(false),
  });
  behaviours.register("sellBin", {
    enter: ({ services }) => services.bin.sellBinEntered(true),
    exit: ({ services }) => services.bin.sellBinEntered(false),
  });
  behaviours.register("deckView", {
    // Read-only: it shows the deck and its Back button goes back; it never changes the deck.
    enter: ({ services }) =>
      services.deckView.show(services.run.deckBlocks(), () => {
        services.sound("ui.back");
        services.run.dispatch("back");
      }),
    exit: ({ services }) => services.deckView.hide(),
  });
  behaviours.register("devAttractTuning", {
    // Testing only: the panel drives the attract background's live tuning (#166).
    enter: ({ services }) => {
      let tuning = services.blockTitles.tuning();
      services.attract.showTuning([
        {
          label: "Word size",
          min: 0.25,
          max: 1.5,
          step: 0.05,
          value: tuning.scale,
          onChange: (scale) => {
            tuning = { ...tuning, scale };
            services.blockTitles.retune(tuning);
          },
        },
        {
          label: "Word phase difference (degrees)",
          min: 0,
          max: 360,
          step: 1,
          value: tuning.phaseDegrees,
          onChange: (phaseDegrees) => {
            tuning = { ...tuning, phaseDegrees };
            services.blockTitles.retune(tuning);
          },
        },
        {
          label: "Precession angle (degrees)",
          min: 0,
          max: 30,
          step: 0.5,
          value: tuning.precessionAngle,
          onChange: (precessionAngle) => {
            tuning = { ...tuning, precessionAngle };
            services.blockTitles.retune(tuning);
          },
        },
        {
          label: "Precession period (s)",
          min: 2,
          max: 120,
          step: 1,
          value: tuning.precessionSeconds,
          onChange: (precessionSeconds) => {
            tuning = { ...tuning, precessionSeconds };
            services.blockTitles.retune(tuning);
          },
        },
        {
          label: "Bounce",
          min: 0,
          max: 0.3,
          step: 0.002,
          value: tuning.bounce,
          onChange: (bounce) => {
            tuning = { ...tuning, bounce };
            services.blockTitles.retune(tuning);
          },
        },
        {
          // The registered dance cycles, in order, picked by position.
          label: "Bounce cycle",
          min: 0,
          max: danceCycles.names().length - 1,
          step: 1,
          value: Math.max(0, danceCycles.names().indexOf(tuning.bounceCycle)),
          format: (index) => danceCycles.names()[index] ?? "",
          onChange: (index) => {
            tuning = { ...tuning, bounceCycle: danceCycles.names()[index] ?? tuning.bounceCycle };
            services.blockTitles.retune(tuning);
          },
        },
        {
          // The registered beat shapes, in order, picked by position.
          label: "Bounce shape",
          min: 0,
          max: beatShapes.names().length - 1,
          step: 1,
          value: Math.max(0, beatShapes.names().indexOf(tuning.bounceShape)),
          format: (index) => beatShapes.names()[index] ?? "",
          onChange: (index) => {
            tuning = { ...tuning, bounceShape: beatShapes.names()[index] ?? tuning.bounceShape };
            services.blockTitles.retune(tuning);
          },
        },
        {
          label: "Bounce window (share of cycle)",
          min: 0.05,
          max: 1,
          step: 0.05,
          value: tuning.bounceWindow,
          onChange: (bounceWindow) => {
            tuning = { ...tuning, bounceWindow };
            services.blockTitles.retune(tuning);
          },
        },
        {
          label: "Bounce attack (envelope: share of the bump spent rising)",
          min: 0.05,
          max: 0.95,
          step: 0.05,
          value: tuning.bounceAttack,
          onChange: (bounceAttack) => {
            tuning = { ...tuning, bounceAttack };
            services.blockTitles.retune(tuning);
          },
        },
        {
          label: "Bounce time messiness (std dev, beats)",
          min: 0,
          max: 0.5,
          step: 0.01,
          value: tuning.bounceTimeSpread,
          onChange: (bounceTimeSpread) => {
            tuning = { ...tuning, bounceTimeSpread };
            services.blockTitles.retune(tuning);
          },
        },
        {
          label: "Bounce angle messiness (std dev, degrees)",
          min: 0,
          max: 30,
          step: 0.5,
          value: tuning.bounceAngleSpread,
          onChange: (bounceAngleSpread) => {
            tuning = { ...tuning, bounceAngleSpread };
            services.blockTitles.retune(tuning);
          },
        },
        {
          // Blocks 1.1 apart start to touch at about 3° each, so the range stays small.
          label: "Initial angle messiness (std dev, degrees)",
          min: 0,
          max: 10,
          step: 0.1,
          value: tuning.restAngleSpread,
          onChange: (restAngleSpread) => {
            tuning = { ...tuning, restAngleSpread };
            services.blockTitles.retune(tuning);
          },
        },
      ]);
    },
    // The panel belongs to this scene, so leaving it takes the panel with it (#166).
    exit: ({ services }) => services.attract.hideTuning(),
  });
  behaviours.register("devShopBalanceEditor", {
    enter: ({ services }, { backTo }) => services.devShopBalanceEditor.show(backTo),
    exit: ({ services }) => services.devShopBalanceEditor.hide(),
  });
  // The profiler trait owns its run policy (#732; doc/automatic-profiling.md, "Composable
  // profiler trait (#669)"): on entry it opens a run scope and, unless configured otherwise,
  // starts the sweep; Run all reruns; exit cancels and delivers any partial result once. The
  // room only measures what it is asked. One scene composes it at a time.
  // Entries are serialised (#735 review): a new entry waits until the previous exit has settled
  // (its sweep cancelled and its partial result delivered), so two sweeps never share the room's
  // runner, and a late result can't land on the next entry. An entry left before it began never
  // starts.
  let profiling: { leave(): Promise<void> } | null = null;
  let settling: Promise<void> = Promise.resolve();
  behaviours.register("devProfiler", {
    enter: ({ services }, config) => {
      services.devProfiler.show(config);
      const scope = services.devProfiler.orchestration();
      const stopRunAll = services.devProfiler.onRunAll(() => void scope.rerun());
      const previous = settling;
      let left = false;
      void previous.then(() => {
        if (!left) void scope.enter(config);
      });
      profiling = {
        leave: () => {
          left = true;
          stopRunAll();
          return previous.then(() => scope.exit());
        },
      };
    },
    exit: ({ services }) => {
      settling = profiling?.leave() ?? settling;
      profiling = null;
      services.devProfiler.hide();
    },
  });
  behaviours.register("devCrystalComparison", {
    enter: ({ services }, config) => services.devCrystalComparison.show(config),
    exit: ({ services }) => services.devCrystalComparison.hide(),
  });
  behaviours.register("devContainedProof", {
    enter: ({ services }, { backTo }) => services.devContainedProof.show(backTo),
    exit: ({ services }) => services.devContainedProof.hide(),
  });
  behaviours.register("devBlockDesigner", {
    enter: ({ services }, { backTo }) => services.devBlockDesigner.show(backTo),
    exit: ({ services }) => services.devBlockDesigner.hide(),
  });
  // Each dialog is its own trait with its own data; all of them hand that data to the dialogs
  // service while their scene is on the stack, so none needs code of its own.
  for (const name of [
    "titleMenuDialog",
    "newGameDialog",
    "pauseDialog",
    "stageWonDialog",
    "gameOverDialog",
  ] as const) {
    const shown = new WeakMap<object, () => void>();
    const show = (context: Context, config: SceneTraits[typeof name]) => {
      shown.get(config)?.();
      const { services } = context;
      shown.set(
        config,
        services.dialogs.add(config, {
          onAction: (action) => services.overlays.choose(action),
          availability: (item) =>
            item.enabledWhen ? menuConditions[item.enabledWhen](context) : true,
        }),
      );
    };
    behaviours.register(name, {
      enter: show,
      // Back in front after a scene over it (Settings, the new-game confirmation) closed.
      resume: show,
      exit: (_context, config) => {
        shown.get(config)?.();
        shown.delete(config);
      },
    });
  }
  behaviours.register("devDialogRoom", {
    enter: ({ services }, config) => services.devDialogRoom.show(config),
    exit: ({ services }) => services.devDialogRoom.hide(),
  });
  behaviours.register("devWordCubeRoom", {
    enter: ({ services }, config) => services.devWordCubeRoom.show(config),
    exit: ({ services }) => services.devWordCubeRoom.hide(),
  });
  behaviours.register("devObjectBrowser", {
    enter: ({ services }, { backTo }) => services.devObjectBrowser.show(backTo),
    exit: ({ services }) => services.devObjectBrowser.hide(),
  });
  behaviours.register("devDropInspector", devDropInspector<Context>());
  behaviours.register("actionHistory", actionHistory<Context>());
  behaviours.register("devManualBlockDestroyer", devManualBlockDestroyer<Context>());
  behaviours.register("hudStyle", hudStyle<Context>());
  behaviours.register("devHudStyleAudition", devHudStyleAudition<Context>());
  behaviours.register("menu", {
    enter(context, { label, items }) {
      context.services.overlays.showMenu(label, itemsToShow(context, items));
    },
    // Back in front after Settings closed over it.
    resume(context, config) {
      behaviours.get("menu").enter?.(context, config);
    },
    exit(context) {
      context.services.overlays.hideMenu();
    },
  });
  behaviours.register("gameOverScreen", {
    enter({ services }, { items }) {
      services.overlays.showGameOver(services.run.runStats(), items, services.run.seed());
    },
    exit: ({ services }) => services.overlays.hideGameOver(),
  });
  behaviours.register("stageWonScreen", {
    enter({ services }, { next }) {
      const reward = services.run.stageReward();
      if (reward) services.overlays.showStageWon(reward, next);
    },
    exit: ({ services }) => services.overlays.hideStageWon(),
  });
  behaviours.register("musicCue", {
    enter: ({ services }, { cue }) => services.audio.playCue(cue),
  });
  // A play scene starts its own music as it comes in front; covering and uncovering it (the
  // pause menu) neither restarts nor changes it.
  behaviours.register("enterSound", {
    enter: ({ services }, { sfx }) => services.sound(sfx),
  });
  behaviours.register("exitSound", {
    exit: ({ services }, { sfx }) => services.sound(sfx),
  });
  // The theatrical arrival (#19): the camera rises to frame the stock as the shop comes in
  // front. Reduced motion keeps the camera still.
  behaviours.register("shopEntrance", {
    enter({ services }) {
      if (!services.run.reducedMotion) services.cameraView.beginShopEntrance();
    },
  });
  behaviours.register("musicTrack", {
    enter: ({ services }, { pool }) => services.audio.playStageMusic(pool),
  });
  behaviours.register("titleScreen", {
    enter(context) {
      context.services.overlays.showTitle();
    },
    // Back in front after a panel opened over it.
    resume(context, config) {
      behaviours.get("titleScreen").enter?.(context, config);
    },
    exit: (context) => context.services.overlays.hideTitle(),
  });
  behaviours.register("panelFooter", {
    enter: (context, { links }) =>
      context.services.overlays.showPanelFooter(links, context.services.version),
    // Back in front after a panel opened over it: its footer was removed with that panel,
    // because a footer belongs to the panel in front, so re-add it here.
    resume: (context, { links }) =>
      context.services.overlays.showPanelFooter(links, context.services.version),
    exit: (context) => context.services.overlays.hidePanelFooter(),
  });
  behaviours.register("settingsPanel", {
    enter: (context) => context.services.overlays.showSettings(),
    exit: (context) => context.services.overlays.hideSettings(),
  });
  // A menu scene filters the music while in front. A covering scene's filter replaces it, and
  // coming back in front restores it; leaving clears it.
  behaviours.register("musicFilter", {
    enter: (context, { kind }) => context.services.audio.setMusicFilter(kind),
    resume: (context, { kind }) => context.services.audio.setMusicFilter(kind),
    exit: (context) => context.services.audio.setMusicFilter(null),
  });
  behaviours.register("keyAction", {
    handles(context, { key, action, sfx }, event) {
      const matches = keyEvents[(event as Event).type];
      if (!matches?.(event as KeyboardEvent, key)) return false;
      // The same sound the matching button plays, so the keyboard isn't silent.
      for (const id of [sfx ?? []].flat()) context.services.sound(id);
      context.services.run.dispatch(action);
      return true;
    },
  });
  behaviours.register("pausesBelow", {
    // A scene that stops input below it also ends any gesture already under way there, so a
    // drag begun before Escape can't play a card behind the menu (#124).
    enter(context, { input }) {
      if (input) context.services.input.cancelGestures();
    },
    blocksBelow(_context, config, operation) {
      return config[operation];
    },
  });
  return behaviours;
}

/** A HUD panel trait: the scene shows its panel, with the trait's config, while in front. */
function panel<Context extends SceneHost, Panel extends HudPanel>(
  name: Panel,
): {
  enter(context: Context, config: HudPanelConfigs[Panel]): void;
  exit(context: Context): void;
} {
  return {
    enter(context, config) {
      context.services.hud.show(name, config);
    },
    exit(context) {
      context.services.hud.hide(name);
    },
  };
}
