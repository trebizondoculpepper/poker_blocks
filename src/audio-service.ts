/**
 * Audio service: the music player and controller, the room's music policy, the volume and
 * mute settings, and the sounds that are about the view rather than a game action.
 *
 * The game says what is happening ("a stage started", "the settings screen is open"); this
 * service decides what the music does. Sound effects for game actions are still played
 * with `playSfx` where the action happens (see AGENTS.md, "Every action has a sound").
 */
import type { MusicController } from "./audio/music-controller";
import type { Phase } from "./game-session";
import type { Screen } from "./menus";
import { createRoomMusicBehaviours, type RoomMusicBehaviour } from "./room-music";
import type { RoomMusicMode } from "./rooms";
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
  /** Use a room's music policy (quiet rooms stay wound down). */
  enterRoom(mode: RoomMusicMode): void;
  /** A stage has just started: boss stages get the boss loop, others a random vibe. */
  stageStarted(phase: Phase): void;
  /** A run has just been set up; quiet rooms wind the music down. */
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

/** A boss stage gets the boss loop; every other start gets a random stage vibe. */
const stageMusic: Record<Phase, (music: MusicController) => void> = {
  "stage-1": (music) => music.switchToRandomStageTrack(),
  "stage-2": (music) => music.switchToRandomStageTrack(),
  boss: (music) => music.switchToBossTrack(),
  shop: (music) => music.switchToRandomStageTrack(),
  over: (music) => music.switchToRandomStageTrack(),
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
  const roomMusicBehaviours = createRoomMusicBehaviours({
    windDown: () => music.windDown(),
    resumeStage: () => music.resumeStage(),
  });
  let roomMusic: RoomMusicBehaviour = roomMusicBehaviours.ordinary;
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
      roomMusic.resume();
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
    enterRoom(mode) {
      roomMusic = roomMusicBehaviours[mode];
    },
    stageStarted(phase) {
      stageMusic[phase](music);
    },
    runStarted() {
      roomMusic.settle();
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
