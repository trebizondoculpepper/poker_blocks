/**
 * The behaviour each room-scene trait installs (see doc/game-architecture.md, "Trait").
 * `screen` marks the host with the scene in front, for styling and tests; `pausesBelow`
 * stops the scenes underneath a pop-up or menu taking input or updates.
 */
import type { SceneTraits } from "./game-modes";
import { SceneTraitRegistry } from "./scenes";

/** What a room-scene trait's behaviour may touch. */
export type SceneHost = { host: HTMLElement };

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
  });
  behaviours.register("pausesBelow", {
    blocksBelow(_context, config, operation) {
      return config[operation];
    },
  });
  return behaviours;
}
