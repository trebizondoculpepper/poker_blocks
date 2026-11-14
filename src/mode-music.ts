import type { MusicOperation } from "./audio/music-controller";
/**
 * The music each game mode plays. A mode composes its style through the `music` mode trait;
 * this module turns that style into the behaviour the audio service drives, so nothing has to
 * ask which mode is open. See doc/game-architecture.md, "Trait".
 */
import type { ModeMusicStyle } from "./game-modes";

export type ModeMusicBehaviour = {
  /** A run has just started. */
  settle(): void;
  /** The game screen came back to the front: run its configured resume cue, as the style allows. */
  resume(operations: readonly MusicOperation[]): void;
  /**
   * Whether this style lets a stage choose its own music. A quiet mode keeps the music wound
   * down instead, so the audio service's stage tracks are never started.
   */
  playsStages(): boolean;
};

/** Music actions a mode uses after a run starts, when its game screen resumes, and per stage. */
export function createModeMusicBehaviours(actions: {
  windDown(): void;
  run(operations: readonly MusicOperation[]): void;
}): Record<ModeMusicStyle, ModeMusicBehaviour> {
  return {
    quiet: {
      settle: () => actions.windDown(),
      resume: () => actions.windDown(),
      playsStages: () => false,
    },
    ordinary: {
      settle() {},
      resume: (operations) => actions.run(operations),
      playsStages: () => true,
    },
  };
}
