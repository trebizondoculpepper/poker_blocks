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
import type { SceneTraits } from "./game-modes";
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
    /** The run, for the game state a scene trait presents. */
    run: Pick<RunController, "shopStock">;
  };
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
