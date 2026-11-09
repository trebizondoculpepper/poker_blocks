import type { RoomMusicMode } from "./rooms";

export type RoomMusicBehaviour = {
  settle(): void;
  resume(): void;
};

/** Music actions a room uses after a run starts and when its game screen resumes. */
export function createRoomMusicBehaviours(actions: {
  windDown(): void;
  resumeStage(): void;
}): Record<RoomMusicMode, RoomMusicBehaviour> {
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
