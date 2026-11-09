/**
 * The music each game mode plays. A mode composes its style through the `music` mode trait;
 * this module turns that style into the behaviour the audio service drives, so nothing has to
 * ask which mode is open. See doc/game-architecture.md, "Trait".
 */
import type { ModeMusicStyle } from "./game-modes";

export type ModeMusicBehaviour = {
  /** A run has just started. */
  settle(): void;
  /** The game screen came back to the front. */
  resume(): void;
  /** A stage has just started, and asks for the boss loop or an ordinary stage track. */
  playStage(track: "boss" | "stage"): void;
};

/** Music actions a mode uses after a run starts, when its game screen resumes, and per stage. */
export function createModeMusicBehaviours(actions: {
  windDown(): void;
  resumeStage(): void;
  playBoss(): void;
  playRandomStage(): void;
}): Record<ModeMusicStyle, ModeMusicBehaviour> {
  return {
    quiet: {
      settle: () => actions.windDown(),
      resume: () => actions.windDown(),
      playStage: () => actions.windDown(),
    },
    ordinary: {
      settle() {},
      resume: () => actions.resumeStage(),
      playStage: (track) => (track === "boss" ? actions.playBoss() : actions.playRandomStage()),
    },
  };
}
