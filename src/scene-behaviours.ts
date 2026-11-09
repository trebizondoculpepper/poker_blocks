/**
 * The behaviour each scene trait installs (see doc/game-architecture.md, "Trait").
 * `screen` marks the host with the scene in front, for styling and tests; `pausesBelow`
 * stops the scenes underneath a pop-up or menu taking input or updates; the HUD panel traits
 * show and hide one panel each; `fieldPlacement` lets the input place blocks onto the field;
 * `shopStock` shows and hides the shop's stock; `devManualBlockDestroyer` (testing only)
 * destroys a double-clicked table block.
 *
 * Each trait brings its own behaviour, so a scene composes the panels and permissions it
 * wants and nothing has to ask which scene is in front.
 */
import type { MenuCondition, SceneTraits } from "./game-modes";
import type { AudioService } from "./audio-service";
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

/** What a scene trait's behaviour may touch. */
export type SceneHost = {
  host: HTMLElement;
  services: {
    board: BlockDestroyerBoard;
    hud: Pick<HudPanels, "show" | "hide">;
    input: Pick<TableInput, "setFieldActive">;
    shop: ShopView;
    /** The run, for the game state a scene trait presents and the actions it dispatches. */
    run: Pick<RunController, "shopStock" | "dispatch" | "inRun">;
    overlays: Pick<Overlays, "showMenu" | "hideMenu" | "showSettings" | "hideSettings">;
    audio: Pick<AudioService, "setMusicFilter">;
  };
};

/** Each menu condition's test: an item naming one is shown only while it holds. */
const menuConditions: Record<MenuCondition, (host: SceneHost) => boolean> = {
  inRun: ({ services }) => services.run.inRun(),
};

/** The scene input a `keyAction` trait reacts to, by event type. */
const keyEvents: Record<string, (event: KeyboardEvent, key: string) => boolean> = {
  keydown: (event, key) => event.key === key,
};

export function sceneBehaviours<Context extends SceneHost>(): SceneTraitRegistry<
  SceneTraits,
  Context
> {
  const behaviours = new SceneTraitRegistry<SceneTraits, Context>();
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
      const shown = items.filter(({ when }) => !when || menuConditions[when](context));
      context.services.overlays.showMenu(label, shown);
    },
    // Back in front after Settings closed over it.
    resume(context, config) {
      behaviours.get("menu").enter?.(context, config);
    },
    exit(context) {
      context.services.overlays.hideMenu();
    },
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
    handles(context, { key, action }, event) {
      const matches = keyEvents[(event as Event).type];
      if (!matches?.(event as KeyboardEvent, key)) return false;
      context.services.run.dispatch(action);
      return true;
    },
  });
  behaviours.register("pausesBelow", {
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
