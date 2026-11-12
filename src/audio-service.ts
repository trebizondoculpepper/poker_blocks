/**
 * Audio service: the music player and controller, the mode's music policy, the volume and
 * mute settings, and the sounds that are about the view rather than a game action.
 *
 * The game says what is happening ("a stage started", "the pause menu is open"); this
 * service decides what the music does. Sound effects for game actions are still played
 * with `playSfx` where the action happens (see AGENTS.md, "Every action has a sound").
 */
import type { MusicController, MusicFilter } from "./audio/music-controller";
import { createModeMusicBehaviours, type ModeMusicBehaviour } from "./mode-music";
import type { ModeMusicStyle } from "./game-modes";
import { silencedAudio, type Settings } from "./settings";

/** The parts of the music player the service drives. */
type MusicOutput = {
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
};

/** The sound-effect mixer and player (`src/audio/sfx.ts`). */
type SfxOutput = {
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  play(id: "view.zoom" | "view.rotate"): void;
};

export type AudioService = {
  /** The music controller, for the developer console. */
  readonly music: MusicController;
  /** Apply the volume, mute and per-channel toggles from the player's settings. */
  applySettings(settings: Settings): void;
  /** Use a mode's music style (quiet modes stay wound down). */
  enterMode(style: ModeMusicStyle): void;
  /**
   * A play scene came in front (its `musicTrack` trait): a fresh track from its pool, a random
   * vibe for a stage or the boss loop, unless the mode keeps its stages quiet.
   */
  playStageMusic(pool: StageMusicPool): void;
  /** A run has just been set up; quiet modes wind the music down. */
  runStarted(): void;
  /** Play a music cue, for a scene's `musicCue` trait. */
  playCue(cue: MusicCue): void;
  /**
   * Filter the music for the scene in front (its `musicFilter` trait), or clear it: low-pass
   * for the pause menu, high-pass for Settings. The track does not change.
   */
  setMusicFilter(kind: MusicFilter | null): void;
  /** The board view zoomed; the zoom sound plays at most every 350 ms. */
  zoomed(): void;
  /** A drag began turning the board view (#641); the turn sound plays at most every 350 ms. */
  turned(): void;
  /** Listen for the first gesture, which browsers require before audio can play. */
  start(): void;
  dispose(): void;
};

/** A music cue a scene can play as it enters (its `musicCue` trait). */
export type MusicCue = "windDown" | "title" | "resumeTable";

/** The pools a play scene's `musicTrack` trait can ask for. */
export type StageMusicPool = "stage" | "boss";

/** How each pool starts its music: a fresh random vibe, or the boss loop. */
const stagePools: Record<StageMusicPool, (music: MusicController) => void> = {
  stage: (music) => music.switchToRandomStageTrack(),
  boss: (music) => music.switchToBossTrack(),
};

/** Music sits a little under the sound effects at the same volume setting. */
const musicVolumeShare = 0.75;
const zoomSoundGapMs = 350;

export function createAudioService(options: {
  player: MusicOutput;
  music: MusicController;
  sfx: SfxOutput;
  /** Where the first pointer or key gesture is heard (the window). */
  gestures: EventTarget;
  now?: () => number;
}): AudioService {
  const { player, music, sfx, gestures } = options;
  const now = options.now ?? (() => performance.now());
  const modeMusicBehaviours = createModeMusicBehaviours({
    windDown: () => music.windDown(),
    resumeStage: () => music.resumeStage(),
  });
  let modeMusic: ModeMusicBehaviour = modeMusicBehaviours.ordinary;
  let lastZoomSoundAt = -Infinity;
  let lastTurnSoundAt = -Infinity;

  /** What each music cue does; a scene names one through its `musicCue` trait. */
  const musicCues: Record<MusicCue, () => void> = {
    windDown: () => music.windDown(),
    title: () => music.playTitle(),
    // Back to the table's music, as the mode plays it (a quiet mode stays wound down).
    resumeTable: () => modeMusic.resume(),
  };

  const unlock = () => music.unlock();
  let started = false;

  return {
    music,
    applySettings(settings) {
      const silenced = silencedAudio(settings);
      sfx.setVolume(settings.volume);
      sfx.setMuted(silenced.sfx);
      player.setVolume(settings.volume * musicVolumeShare);
      player.setMuted(silenced.music);
    },
    enterMode(style) {
      modeMusic = modeMusicBehaviours[style];
    },
    playStageMusic(pool) {
      if (!modeMusic.playsStages()) return;
      stagePools[pool](music);
    },
    runStarted() {
      modeMusic.settle();
    },
    playCue(cue) {
      musicCues[cue]();
    },
    setMusicFilter(kind) {
      music.filter(kind);
    },
    zoomed() {
      const at = now();
      if (at - lastZoomSoundAt > zoomSoundGapMs) sfx.play("view.zoom");
      lastZoomSoundAt = at;
    },
    turned() {
      const at = now();
      if (at - lastTurnSoundAt > zoomSoundGapMs) sfx.play("view.rotate");
      lastTurnSoundAt = at;
    },
    start() {
      if (started) return;
      started = true;
      gestures.addEventListener("pointerdown", unlock, { capture: true });
      gestures.addEventListener("keydown", unlock, { capture: true });
    },
    dispose() {
      gestures.removeEventListener("pointerdown", unlock, { capture: true });
      gestures.removeEventListener("keydown", unlock, { capture: true });
      started = false;
    },
  };
}
