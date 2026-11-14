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
   * `bounceWindow` squeezes the shape into that fraction of the cycle, resting either side,
   * placed so its peak (`bounceAttack` of the way through, default the middle) lands on the
   * cycle's start, the downbeat. With `sine` it is a raised-cosine bump; with `envelope`,
   * `bounceAttack` also sets how quickly it rises against how slowly it falls.
   * Each letter block bounces on its own: `bounceTimeSpread` (beats) and `bounceAngleSpread`
   * (degrees from vertical) are standard deviations that put some a little ahead or behind
   * and lean their bounce off true, so the word moves less like one rigid piece.
   * `restAngleSpread` (degrees, a standard deviation per axis) turns each block a little from
   * its neighbours at rest, for some disorder. Keep it small: blocks start to touch at ~3°.
   */
  dance?: {
    cycle?: string;
    bounceCycle?: string;
    bounceShape?: string;
    bounceWindow?: number;
    bounceAttack?: number;
    bounceTimeSpread?: number;
    bounceAngleSpread?: number;
    restAngleSpread?: number;
    phaseStep?: number;
    bounce?: number;
    tilt?: number;
  };
};
/** What the developer tuning panel can change on a live title (dev7). */
export type BlockTitleTuning = {
  scale: number;
  phaseDegrees: number;
  /** The precession's cone angle, in degrees. */
  precessionAngle: number;
  /** Seconds for one precession circle. */
  precessionSeconds: number;
  /** How high the bounce lifts the row. */
  bounce: number;
  /** The bounce's registered dance cycle. */
  bounceCycle: string;
  /** The bounce's registered beat shape. */
  bounceShape: string;
  /** The fraction of the cycle the bounce takes, peaking on the downbeat. */
  bounceWindow: number;
  /** How far through the bounce it peaks: its attack, against the decay after. */
  bounceAttack: number;
  /** Standard deviation of each block's bounce timing, in beats. */
  bounceTimeSpread: number;
  /** Standard deviation of each block's bounce direction from vertical, in degrees. */
  bounceAngleSpread: number;
  /** Standard deviation of each block's resting turn about each axis, in degrees. */
  restAngleSpread: number;
};
export type BlockTitles = {
  tuning(): BlockTitleTuning;
  retune(tuning: BlockTitleTuning): void;
  show(config: BlockTitleConfig): () => void;
  frame(): void;
  /** The titles mounted now, for the debug snapshot (#987): read-only, plain data. */
  mounted(): { text: string; scale: number }[];
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
