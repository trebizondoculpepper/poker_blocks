/**
 * Audio service: the music player and controller, the mode's music policy, the volume and
 * mute settings, and the sounds that are about the view rather than a game action.
 *
 * The game says what is happening ("a stage started", "the pause menu is open"); this
 * service decides what the music does. Sound effects for game actions are still played
 * with `playSfx` where the action happens (see AGENTS.md, "Every action has a sound").
 */
import type { MusicController, MusicFilter, MusicOperation } from "./audio/music-controller";
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
  play(id: "view.zoom"): void;
};

export type AudioService = {
  /** The music controller, for the developer console. */
  readonly music: MusicController;
  /** Apply the volume, mute and per-channel toggles from the player's settings. */
  applySettings(settings: Settings): void;
  /** Use a mode's music style (quiet modes stay wound down). */
  enterMode(style: ModeMusicStyle): void;
  /**
   * A play scene came in front (its `musicTrack` trait): its configured operations choose its
   * music, unless the mode keeps its stages quiet.
   */
  playStageMusic(operations: readonly MusicOperation[]): void;
  /** A run has just been set up; quiet modes wind the music down. */
  runStarted(): void;
  /** Run a scene's music cue: its configured operations (its `musicCue` trait). */
  playCue(operations: readonly MusicOperation[]): void;
  /**
   * Back to the table's music, as the mode plays it: the scene's configured resume cue (its
   * `musicResume` trait), or a wind-down in a quiet mode.
   */
  resumeTable(operations: readonly MusicOperation[]): void;
  /**
   * Filter the music for the scene in front (its `musicFilter` trait), or clear it: low-pass
   * for the pause menu, high-pass for Settings. The track does not change.
   */
  setMusicFilter(kind: MusicFilter | null): void;
  /** The board view zoomed; the zoom sound plays at most every 350 ms. */
  zoomed(): void;
  /** Listen for the first gesture, which browsers require before audio can play. */
  start(): void;
  dispose(): void;
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
    run: (operations) => music.run(operations),
  });
  let modeMusic: ModeMusicBehaviour = modeMusicBehaviours.ordinary;
  let lastZoomSoundAt = -Infinity;

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
    playStageMusic(operations) {
      if (!modeMusic.playsStages()) return;
      music.run(operations);
    },
    runStarted() {
      modeMusic.settle();
    },
    playCue(operations) {
      music.run(operations);
    },
    resumeTable(operations) {
      modeMusic.resume(operations);
    },
    setMusicFilter(kind) {
      music.filter(kind);
    },
    zoomed() {
      const at = now();
      if (at - lastZoomSoundAt > zoomSoundGapMs) sfx.play("view.zoom");
      lastZoomSoundAt = at;
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
