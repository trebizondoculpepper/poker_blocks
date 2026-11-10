import type { SceneTraitBehaviour } from "../scenes";

export type BlockTitleConfig = {
  text: string;
  /** Relative size; 1 is full size, .5 is half size. */
  scale: number;
  rowSpacing?: number;
  dance?: { cycle?: string; phaseStep?: number; bounce?: number; tilt?: number };
};
export type BlockTitles = {
  show(config: BlockTitleConfig): () => void;
  frame(): void;
  dispose(): void;
};

/** A scene owns one title instance, even while a modal is stacked over it. */
export function blockTitle<
  Context extends { services: { blockTitles: Pick<BlockTitles, "show"> } },
>(): SceneTraitBehaviour<Context, BlockTitleConfig> {
  const exits = new WeakMap<BlockTitleConfig, () => void>();
  return {
    enter({ services }, config) {
      exits.set(config, services.blockTitles.show(config));
    },
    exit(_context, config) {
      exits.get(config)?.();
      exits.delete(config);
    },
  };
}
