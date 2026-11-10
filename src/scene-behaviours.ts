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
import { devDropInspector } from "./scene-traits/dev-drop-inspector";
import { actionHistory, type ActionWatch } from "./scene-traits/action-history";
import type { ActionLog } from "./action-log";
import { firstPlayPrompt, type FirstPlayTable } from "./scene-traits/first-play-prompt";
import type { MenuCondition, MenuItem, SceneTraits } from "./game-modes";
import type { AudioService } from "./audio-service";
import type { CameraViewService } from "./camera-view";
import type { Overlays } from "./overlays";
import type { HudPanel, HudPanelConfigs, HudPanels } from "./hud-panels";
import type { RunController } from "./run-controller";
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
    attract: { start(): void; stop(): void; showTuning(): void; hideTuning(): void };
    /** Whether the room and table are drawn while a scene composing `tableBackground` is in front. */
    renderer: Pick<TableRenderer, "tableEntered" | "handEntered">;
    hud: Pick<HudPanels, "show" | "hide">;
    input: Pick<
      TableInput,
      | "cancelGestures"
      | "discardBinEntered"
      | "sellBinEntered"
      | "handEntered"
      | "enableDropTarget"
      | "enableDragSource"
      | "enableBoardGestures"
    >;
    shop: ShopView;
    /** The passive rack, shown while a scene composing `passiveRackView` is on the stack. */
    rack: { viewEntered(entered: boolean, capacity: number): void };
    /** The read-only deck view (#175). */
    deckView: Pick<DeckView, "show" | "hide">;
    devShopBalanceEditor: Pick<ShopBalanceEditor, "show" | "hide">;
    devObjectBrowser: Pick<ShopBalanceEditor, "show" | "hide">;
    /** The run, for the game state a scene trait presents and the actions it dispatches. */
    run: Pick<
      RunController,
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
  behaviours.register("shopStock", {
    enter({ services }) {
      services.shop.render(services.run.shopStock(), true);
    },
    exit({ services }) {
      services.shop.render([], false);
    },
  });
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
    // Drawn and reachable together: a scene without the hand can neither see nor touch it.
    enter({ services }) {
      services.renderer.handEntered(true);
      services.input.handEntered(true);
    },
    exit({ services }) {
      services.renderer.handEntered(false);
      services.input.handEntered(false);
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
    enter({ services }, config) {
      gesturesBound.set(config, services.input.enableBoardGestures());
    },
    exit(_context, config) {
      gesturesBound.get(config)?.();
      gesturesBound.delete(config);
    },
  });
  behaviours.register("passiveRackView", {
    enter: ({ services }) => services.rack.viewEntered(true, services.run.rackCapacity()),
    exit: ({ services }) => services.rack.viewEntered(false, services.run.rackCapacity()),
  });
  behaviours.register("discardBin", {
    enter: ({ services }) => services.input.discardBinEntered(true),
    exit: ({ services }) => services.input.discardBinEntered(false),
  });
  behaviours.register("sellBin", {
    enter: ({ services }) => services.input.sellBinEntered(true),
    exit: ({ services }) => services.input.sellBinEntered(false),
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
    enter: ({ services }) => services.attract.showTuning(),
    // The panel belongs to this scene, so leaving it takes the panel with it (#166).
    exit: ({ services }) => services.attract.hideTuning(),
  });
  behaviours.register("devShopBalanceEditor", {
    enter: ({ services }, { backTo }) => services.devShopBalanceEditor.show(backTo),
    exit: ({ services }) => services.devShopBalanceEditor.hide(),
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
    enter(context, { items }) {
      context.services.overlays.showTitle(itemsToShow(context, items));
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
