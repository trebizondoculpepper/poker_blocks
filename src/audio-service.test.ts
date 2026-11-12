import { describe, expect, it } from "vite-plus/test";
import type { MusicController } from "./audio/music-controller";
import { createAudioService } from "./audio-service";
import { defaultSettings } from "./settings";

function setup() {
  const calls: string[] = [];
  const log =
    (name: string) =>
    (...args: unknown[]) =>
      void calls.push(args.length ? `${name} ${args.join(" ")}` : name);
  const music = {
    playTitle: log("playTitle"),
    switchToRandomStageTrack: log("randomStage"),
    switchToBossTrack: log("boss"),
    resumeStage: log("resumeStage"),
    filter: log("filter"),
    windDown: log("windDown"),
    windUp: log("windUp"),
    woundDown: false,
    play: log("play"),
    stop: log("stop"),
    unlock: log("unlock"),
    current: null,
    tracks: [],
  } satisfies MusicController;
  let clock = 0;
  const gestures = new EventTarget();
  const audio = createAudioService({
    player: { setVolume: log("musicVolume"), setMuted: log("musicMuted") },
    music,
    sfx: { setVolume: log("sfxVolume"), setMuted: log("sfxMuted"), play: log("sfx") },
    gestures,
    now: () => clock,
  });
  return { audio, calls, gestures, tick: (ms: number) => (clock += ms) };
}

describe("audio service", () => {
  it("plays the boss loop from the boss pool and a random vibe from the stage pool (#92)", () => {
    const { audio, calls } = setup();
    audio.playStageMusic("stage");
    audio.playStageMusic("boss");
    audio.playStageMusic("stage");
    expect(calls).toEqual(["randomStage", "boss", "randomStage"]);
  });

  it("plays each scene's music cue, and leaves filtering to the menu scenes (#179)", () => {
    const { audio, calls } = setup();
    audio.playCue("title");
    audio.playCue("resumeTable");
    audio.playCue("windDown");
    expect(calls).toEqual(["playTitle", "resumeStage", "windDown"]);
    calls.length = 0;
    audio.setMusicFilter("lowpass");
    audio.setMusicFilter(null);
    expect(calls).toEqual(["filter lowpass", "filter "]);
  });

  it("keeps a quiet mode wound down after a run starts and when the table's music resumes", () => {
    const { audio, calls } = setup();
    audio.enterMode("quiet");
    audio.runStarted();
    audio.playCue("resumeTable");
    expect(calls).toEqual(["windDown", "windDown"]);

    calls.length = 0;
    audio.enterMode("ordinary");
    audio.runStarted();
    audio.playCue("resumeTable");
    expect(calls).toEqual(["resumeStage"]);
  });

  it("sets music a little under the effects, and honours the master and channel mutes", () => {
    const { audio, calls } = setup();
    audio.applySettings({ ...defaultSettings, volume: 0.8, sfx: false });
    expect(calls).toEqual([
      "sfxVolume 0.8",
      "sfxMuted true",
      "musicVolume 0.6000000000000001",
      "musicMuted false",
    ]);
  });

  it("plays the zoom sound at most every 350 ms while zooming continues", () => {
    const { audio, calls, tick } = setup();
    audio.zoomed();
    tick(200);
    audio.zoomed();
    tick(200);
    audio.zoomed();
    tick(400);
    audio.zoomed();
    expect(calls).toEqual(["sfx view.zoom", "sfx view.zoom"]);
  });

  it("plays the turn sound as a board drag begins, at most every 350 ms (#641)", () => {
    const { audio, calls, tick } = setup();
    audio.turned();
    tick(100);
    audio.turned();
    tick(400);
    audio.turned();
    expect(calls).toEqual(["sfx view.rotate", "sfx view.rotate"]);
  });

  it("unlocks the music on the first gesture, until disposed", () => {
    const { audio, calls, gestures } = setup();
    audio.start();
    gestures.dispatchEvent(new Event("pointerdown"));
    audio.dispose();
    gestures.dispatchEvent(new Event("keydown"));
    expect(calls).toEqual(["unlock"]);
  });
});
