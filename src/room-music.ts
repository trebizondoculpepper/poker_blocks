import type { RoomMusicMode } from "./rooms";

export type RoomMusicBehaviour = {
  settle(): void;
  resume(): void;
  playStage(isBoss: boolean): void;
};

/** Music actions a room uses after a run starts and when its game screen resumes. */
export function createRoomMusicBehaviours(actions: {
  windDown(): void;
  resumeStage(): void;
  playBoss(): void;
  playRandomStage(): void;
}): Record<RoomMusicMode, RoomMusicBehaviour> {
  return {
    quiet: {
      settle: () => actions.windDown(),
      resume: () => actions.windDown(),
      playStage: () => actions.windDown(),
    },
    ordinary: {
      settle() {},
      resume: () => actions.resumeStage(),
      playStage: (isBoss) => (isBoss ? actions.playBoss() : actions.playRandomStage()),
    },
  };
}
