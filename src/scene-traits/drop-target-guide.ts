/**
 * `dropTargetGuide` (#922; doc/presentation-contracts.md, "Laser target-guide controller"): while
 * a scene composing it shows, a laser guide marks where a drag is guided to, or a red X when its
 * drop would be refused. The configuration names a registered guide provider and the two looks;
 * the trait never asks what scene it is in or what is dragged. Entering mounts the controller on
 * the scene host's overlay; exiting disposes it, so a later scene starts clean.
 */
import type { SceneTraitBehaviour } from "../scenes";
import type { DragLifecycle } from "../drag-drop";
import {
  createDropTargetGuide,
  type DropTargetGuide,
  type DropTargetGuideConfig,
} from "../visual/drop-target-guide";

type Context = {
  host: HTMLElement;
  services: {
    input: { observeDrag(listener: (event: DragLifecycle) => void): () => void };
    run: { readonly reducedMotion: boolean };
  };
};

export function dropTargetGuide<C extends Context>(): SceneTraitBehaviour<
  C,
  DropTargetGuideConfig
> {
  const guides = new WeakMap<DropTargetGuideConfig, { guide: DropTargetGuide; seconds: number }>();
  return {
    enter({ host, services }, config) {
      guides.get(config)?.guide.dispose();
      guides.set(config, {
        guide: createDropTargetGuide(config, {
          element: host,
          observeDrag: (listener) => services.input.observeDrag(listener),
        }),
        seconds: 0,
      });
    },
    update({ services }, config, dt) {
      const entry = guides.get(config);
      if (!entry) return;
      entry.seconds += dt;
      entry.guide.frame(entry.seconds, services.run.reducedMotion);
    },
    exit(_context, config) {
      guides.get(config)?.guide.dispose();
      guides.delete(config);
    },
  };
}
