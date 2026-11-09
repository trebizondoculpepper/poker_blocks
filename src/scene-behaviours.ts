/**
 * The behaviour each room-scene trait installs (see doc/game-architecture.md, "Trait").
 * `screen` marks the host with the scene in front, for styling and tests; `pausesBelow`
 * stops the scenes underneath a pop-up or menu taking input or updates.
 */
import type { RoomSceneTraits } from "./rooms";
import { SceneTraitRegistry } from "./scenes";

/** What a room-scene trait's behaviour may touch. */
export type SceneHost = { host: HTMLElement };

export function roomSceneBehaviours<Context extends SceneHost>(): SceneTraitRegistry<
  RoomSceneTraits,
  Context
> {
  const behaviours = new SceneTraitRegistry<RoomSceneTraits, Context>();
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
