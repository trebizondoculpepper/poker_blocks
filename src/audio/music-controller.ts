/**
 * The one place that decides music transitions. The game says what to play ("title
 * music", "a random stage track", "wind down") and the controller picks tracks from the
 * music plan and tells the player how to get there. Requests made before the browser allows
 * audio are remembered and played on the first gesture.
 *
 * It remembers the record player's state: once wound down, the next music winds back up
 * from a standstill instead of fading in.
 */
import { defaultMusicPlan, pickTrack, type MusicPlan } from "./music-plan";
import type { MusicPlayer } from "./music-player";

export type MusicController = {
  /** Horns or sleaze; keeps playing if a title track already is. */
  playTitle(): void;
  /** A new normal stage: switch to a random stage vibe (never the same one twice running). */
  switchToRandomStageTrack(): void;
  /** A boss stage: switch to the boss loop. */
  switchToBossTrack(): void;
  /** Back to the table (from the title or a lost run's screen): the current stage's track. */
  resumeStage(): void;
  /**
   * Filter whatever is playing, easing over about 2 s; the track does not change. `lowpass`
   * muffles it (the pause menu), `highpass` thins it (Settings), and null clears both. Setting
   * one replaces the other.
   */
  filter(kind: MusicFilter | null): void;
  /** Wind the music down to silence, like a record player losing power. */
  windDown(): void;
  /** Wind back up whatever was playing before the wind-down. */
  windUp(): void;
  /** Whether the record player is wound down (the next music winds up). */
  readonly woundDown: boolean;
  /** A specific loop, for the console. */
  play(id: string): void;
  stop(): void;
  /** Call on the first user gesture; plays whatever was last asked for. */
  unlock(): void;
  readonly current: string | null;
  readonly tracks: readonly string[];
};

/** A menu's music filter: muffled (low-pass) or thinned (high-pass). */
export type MusicFilter = "lowpass" | "highpass";

/** The muffled cut-off, in hertz: the music as if through a wall. */
export const muffledCutoff = 550;
/** Seconds the muffle takes to come on or go off. */
export const muffleSeconds = 2;

export function createMusicController(
  player: Pick<
    MusicPlayer,
    | "play"
    | "stop"
    | "windDown"
    | "windUp"
    | "unlock"
    | "current"
    | "setLowPass"
    | "clearLowPass"
    | "setHighPass"
    | "clearHighPass"
  >,
  tracks: readonly string[],
  plan: MusicPlan = defaultMusicPlan,
  random: () => number = Math.random,
): MusicController {
  let unlocked = false;
  const filters: Record<MusicFilter, { on: () => void; off: () => void }> = {
    lowpass: {
      on: () => player.setLowPass(muffledCutoff, muffleSeconds),
      off: () => player.clearLowPass(muffleSeconds),
    },
    highpass: {
      on: () => player.setHighPass(muffledCutoff, muffleSeconds),
      off: () => player.clearHighPass(muffleSeconds),
    },
  };
  /** The loop for the current stage, kept while visiting settings. */
  let stageTrack: string | null = null;
  /** The last request, replayed on unlock. */
  let wanted: () => void = () => {};
  let woundDown = false;
  /** What was playing when the music wound down, for windUp(). */
  let beforeWindDown: string | null = null;

  const request = (action: () => void) => {
    wanted = action;
    if (unlocked) action();
  };
  /**
   * Start a loop. From silence (nothing playing, as on page load, or after a wind-down) it spins
   * up like a record player coming up to speed; over music already playing it crossfades.
   */
  const start = (id: string | null) => {
    if (!id) return;
    if (woundDown || player.current === null) {
      woundDown = false;
      void player.windUp(id);
    } else {
      void player.play(id);
    }
  };
  const playStage = () => {
    stageTrack ??= pickTrack("stage", tracks, random);
    start(stageTrack);
  };

  return {
    playTitle: () =>
      request(() => {
        if (woundDown || !plan.title.includes(player.current ?? ""))
          start(pickTrack("title", tracks, random));
      }),
    switchToRandomStageTrack() {
      stageTrack = pickTrack("stage", tracks, random, stageTrack);
      request(playStage);
    },
    switchToBossTrack() {
      stageTrack = pickTrack("boss", tracks, random);
      request(playStage);
    },
    resumeStage: () => request(playStage),
    // Not a request: the filter applies to whatever plays, so it never replaces one.
    filter(kind) {
      // The filter asked for comes on and every other one goes off.
      for (const [name, filter] of Object.entries(filters)) {
        if (name === kind) filter.on();
        else filter.off();
      }
    },
    windDown: () =>
      request(() => {
        if (woundDown) return;
        beforeWindDown = player.current;
        woundDown = true;
        player.windDown();
      }),
    windUp: () => request(() => start(beforeWindDown)),
    get woundDown() {
      return woundDown;
    },
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
