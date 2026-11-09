import type { ModeMusicStyle } from "./game-modes";

export type ModeMusicBehaviour = {
  settle(): void;
  resume(): void;
};

/** Music actions a room uses after a run starts and when its game screen resumes. */
export function createModeMusicBehaviours(actions: {
  windDown(): void;
  resumeStage(): void;
}): Record<ModeMusicStyle, ModeMusicBehaviour> {
  return {
    quiet: {
      settle: () => actions.windDown(),
      resume: () => actions.windDown(),
    },
    ordinary: {
      settle() {},
      resume: () => actions.resumeStage(),
    },
  };
}
