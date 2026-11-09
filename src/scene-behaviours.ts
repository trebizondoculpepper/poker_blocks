/**
 * The behaviour each scene trait installs (see doc/game-architecture.md, "Trait").
 * `screen` marks the host with the scene in front, for styling and tests; `pausesBelow`
 * stops the scenes underneath a pop-up or menu taking input or updates; the HUD panel traits
 * show and hide one panel each; `fieldPlacement` lets the input place blocks onto the field;
 * `shopStock` shows and hides the shop's stock; `gameOverScreen` shows the run's totals and
 * choices; `musicCue` plays a music cue on entering; `devManualBlockDestroyer` (testing only)
 * destroys a double-clicked table block.
 *
 * Each trait brings its own behaviour, so a scene composes the panels and permissions it
 * wants and nothing has to ask which scene is in front.
 */
import type { MenuCondition, MenuItem, SceneTraits } from "./game-modes";
import type { AudioService } from "./audio-service";
import type { CameraViewService } from "./camera-view";
import type { Overlays } from "./overlays";
import type { HudPanels } from "./hud-panels";
import type { RunController } from "./run-controller";
import type { ShopView } from "./shop-view";
import type { TableInput } from "./table-input";
import {
  devManualBlockDestroyer,
  type BlockDestroyerBoard,
} from "./scene-traits/dev-manual-block-destroyer";
import { SceneTraitRegistry } from "./scenes";
import type { SoundEffectId } from "./audio/sfx-registry";

/** What a scene trait's behaviour may touch. */
export type SceneHost = {
  host: HTMLElement;
  services: {
    board: BlockDestroyerBoard;
    hud: Pick<HudPanels, "show" | "hide">;
    input: Pick<TableInput, "setFieldActive" | "cancelGestures">;
    shop: ShopView;
    /** The run, for the game state a scene trait presents and the actions it dispatches. */
    run: Pick<RunController, "shopStock" | "dispatch" | "hasSave" | "runStats" | "reducedMotion">;
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
  behaviours.register("roundPanel", panel<Context>("round"));
  behaviours.register("deckPanel", panel<Context>("deck"));
  behaviours.register("coinsPanel", panel<Context>("coins"));
  behaviours.register("shopExit", panel<Context>("shopExit"));
  behaviours.register("fieldPlacement", {
    enter(context) {
      context.services.input.setFieldActive(true);
    },
    exit(context) {
      context.services.input.setFieldActive(false);
    },
  });
  behaviours.register("shopStock", {
    enter({ services }) {
      services.shop.render(services.run.shopStock(), true);
    },
    exit({ services }) {
      services.shop.render([], false);
    },
  });
  behaviours.register("devManualBlockDestroyer", devManualBlockDestroyer<Context>());
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
      services.overlays.showGameOver(services.run.runStats(), items);
    },
    exit: ({ services }) => services.overlays.hideGameOver(),
  });
  behaviours.register("musicCue", {
    enter: ({ services }, { cue }) => services.audio.playCue(cue),
  });
  // A play scene starts its own music as it comes in front; covering and uncovering it (the
  // pause menu) neither restarts nor changes it.
  behaviours.register("enterSound", {
    enter: ({ services }, { sfx }) => services.sound(sfx),
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

/** A HUD panel trait: the scene shows its panel while it is in front. */
function panel<Context extends SceneHost>(
  name: Parameters<SceneHost["services"]["hud"]["show"]>[0],
): {
  enter(context: Context): void;
  exit(context: Context): void;
} {
  return {
    enter(context) {
      context.services.hud.show(name);
    },
    exit(context) {
      context.services.hud.hide(name);
    },
  };
}
