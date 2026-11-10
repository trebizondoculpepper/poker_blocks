import type { SceneTraitBehaviour } from "../scenes";

export type BlockTitleConfig = {
  text: string;
  /** Relative size; 1 is full size, .5 is half size. */
  scale: number;
  rowSpacing?: number;
  /** Slow circular tilt: cycle length in seconds and cone angle in degrees. */
  precession?: { seconds?: number; angle?: number; phaseDegrees?: number };
  /**
   * Dancing with the music: each row tilts side to side over `cycle` and lifts once per
   * `bounceCycle` (both registered dance cycles), shaped by `bounceShape` (a registered beat
   * shape). The defaults, `halfBeat` and `bounce`, hop at each extreme of a beat's tilt.
   */
  dance?: {
    cycle?: string;
    bounceCycle?: string;
    bounceShape?: string;
    phaseStep?: number;
    bounce?: number;
    tilt?: number;
  };
};
export type BlockTitleTuning = { scale: number; phaseDegrees: number };
export type BlockTitles = {
  tuning(): BlockTitleTuning;
  retune(tuning: BlockTitleTuning): void;
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
