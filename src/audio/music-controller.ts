/**
 * The one place that decides music transitions. The game says what is happening ("play the
 * title music", "a new stage started", "game over") and the controller picks tracks from the
 * music plan and tells the player how to get there. Requests made before the browser allows
 * audio are remembered and played on the first gesture.
 */
import { defaultMusicPlan, pickTrack, type MusicPlan } from "./music-plan";
import type { MusicPlayer } from "./music-player";

export type MusicController = {
  /** Horns or sleaze; keeps playing if a title track already is. */
  playTitle(): void;
  /** The mellow loop reserved for the settings screen. */
  playSettings(): void;
  /** A new normal stage: switch to a random stage vibe (never the same one twice running). */
  switchToRandomStageTrack(): void;
  /** A boss stage: switch to the boss loop. */
  switchToBossTrack(): void;
  /** Back to the table (closing settings): the current stage's track. */
  resumeStage(): void;
  /** The run is lost: the music winds down like a record player losing power. */
  gameOver(): void;
  /** A specific loop, for the console. */
  play(id: string): void;
  stop(): void;
  /** Call on the first user gesture; plays whatever was last asked for. */
  unlock(): void;
  readonly current: string | null;
  readonly tracks: readonly string[];
};

export function createMusicController(
  player: Pick<MusicPlayer, "play" | "stop" | "powerDown" | "unlock" | "current">,
  tracks: readonly string[],
  plan: MusicPlan = defaultMusicPlan,
  random: () => number = Math.random,
): MusicController {
  let unlocked = false;
  /** The loop for the current stage, kept while visiting settings. */
  let stageTrack: string | null = null;
  /** The last request, replayed on unlock. */
  let wanted: () => void = () => {};

  const request = (action: () => void) => {
    wanted = action;
    if (unlocked) action();
  };
  const start = (id: string | null) => {
    if (id) void player.play(id);
  };
  const playStage = () => {
    stageTrack ??= pickTrack("stage", tracks, random);
    start(stageTrack);
  };

  return {
    playTitle: () =>
      request(() => {
        if (!plan.title.includes(player.current ?? "")) start(pickTrack("title", tracks, random));
      }),
    playSettings: () => request(() => start(pickTrack("settings", tracks, random))),
    switchToRandomStageTrack() {
      stageTrack = pickTrack("stage", tracks, random, stageTrack);
      request(playStage);
    },
    switchToBossTrack() {
      stageTrack = pickTrack("boss", tracks, random);
      request(playStage);
    },
    resumeStage: () => request(playStage),
    gameOver: () => request(() => player.powerDown(3)),
    play: (id) => request(() => start(id)),
    stop: () => request(() => player.stop()),
    unlock() {
      player.unlock();
      if (unlocked) return;
      unlocked = true;
      wanted();
    },
    get current() {
      return player.current;
    },
    tracks,
  };
}
