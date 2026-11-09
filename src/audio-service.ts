/**
 * Audio service: the music player and controller, the mode's music policy, the volume and
 * mute settings, and the sounds that are about the view rather than a game action.
 *
 * The game says what is happening ("a stage started", "the settings screen is open"); this
 * service decides what the music does. Sound effects for game actions are still played
 * with `playSfx` where the action happens (see AGENTS.md, "Every action has a sound").
 */
import type { MusicController } from "./audio/music-controller";
import type { RunPhase } from "./game-run";
import type { Screen } from "./menus";
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
  /** A stage has just started: boss stages get the boss loop, others a random vibe. */
  stageStarted(phase: RunPhase): void;
  /** A run has just been set up; quiet modes wind the music down. */
  runStarted(): void;
  /** A menu screen came to the front. */
  showScreen(screen: Screen): void;
  /** The board view zoomed; the zoom sound plays at most every 350 ms. */
  zoomed(): void;
  /** Listen for the first gesture, which browsers require before audio can play. */
  start(): void;
  dispose(): void;
};

/** Music sits a little under the sound effects at the same volume setting. */
const musicVolumeShare = 0.75;
const zoomSoundGapMs = 350;

/** Which track a run's phase asks for, as a lookup rather than a branch on the phase. */
const stageTrack: Record<RunPhase, "boss" | "stage"> = {
  "stage-1": "stage",
  "stage-2": "stage",
  boss: "boss",
  shop: "stage",
  over: "stage",
};

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
    playBoss: () => music.switchToBossTrack(),
    playRandomStage: () => music.switchToRandomStageTrack(),
  });
  let modeMusic: ModeMusicBehaviour = modeMusicBehaviours.ordinary;
  let lastZoomSoundAt = -Infinity;

  const screenMusic: Record<Screen, () => void> = {
    title() {
      music.unmuffle();
      music.playTitle();
    },
    // The menu muffles whatever is playing instead of changing the song.
    settings() {
      music.muffle();
    },
    game() {
      music.unmuffle();
      modeMusic.resume();
    },
    over() {
      music.unmuffle();
      music.windDown();
    },
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
    stageStarted(phase) {
      // A run stands in the shop before any stage; the shop's music is the stage vibe.
      modeMusic.playStage(stageTrack[phase]);
    },
    runStarted() {
      modeMusic.settle();
    },
    showScreen(screen) {
      screenMusic[screen]();
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
