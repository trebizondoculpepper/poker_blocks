/**
 * `dropTargetGuide` (#922; doc/presentation-contracts.md, "Laser target-guide controller"): while
 * a scene composing it shows, a laser guide marks where a drag is guided to, or a red X when its
 * drop would be refused. The configuration names a registered guide provider and the two looks;
 * the trait never asks what scene it is in or what is dragged. Entering mounts a controller from
 * the drop-guide service; exiting disposes it, so a later scene starts clean.
 */
import type { SceneTraitBehaviour } from "../scenes";
import type { DropTargetGuide, DropTargetGuideConfig } from "../visual/drop-target-guide";

/** Makes guide controllers on the scene host's overlay layer (wired in src/main.ts). */
export type DropTargetGuides = { create(config: DropTargetGuideConfig): DropTargetGuide };

type Context = {
  services: { dropTargetGuides: DropTargetGuides; run: { readonly reducedMotion: boolean } };
};

export function dropTargetGuide<C extends Context>(): SceneTraitBehaviour<
  C,
  DropTargetGuideConfig
> {
  const guides = new WeakMap<DropTargetGuideConfig, { guide: DropTargetGuide; seconds: number }>();
  return {
    enter({ services }, config) {
      guides.get(config)?.guide.dispose();
      guides.set(config, { guide: services.dropTargetGuides.create(config), seconds: 0 });
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
