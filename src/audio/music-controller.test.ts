import { describe, expect, it } from "vite-plus/test";
import { createMusicController } from "./music-controller";
import { defaultMusicPlan } from "./music-plan";

const tracks = [
  "take2",
  "blaxploitation-horns",
  "stripped-sleaze",
  "style-noir",
  "style-ambient-lounge",
  "solitaire-boss",
];

function setup() {
  const log: string[] = [];
  let current: string | null = null;
  const player = {
    get current() {
      return current;
    },
    play: async (id: string) => {
      current = id;
      log.push(`play ${id}`);
    },
    stop: () => {
      current = null;
      log.push("stop");
    },
    windDown: (seconds?: number) => {
      current = null;
      log.push(`windDown ${seconds}`);
    },
    windUp: async (id: string) => {
      current = id;
      log.push(`windUp ${id}`);
    },
    unlock: () => log.push("unlock"),
  };
  const music = createMusicController(player, tracks, defaultMusicPlan, () => 0);
  return { music, log };
}

describe("music controller", () => {
  it("waits for the first gesture, then plays the last request", () => {
    const { music, log } = setup();
    music.playTitle();
    music.playSettings();
    expect(log).toEqual([]);
    music.unlock();
    expect(log).toEqual(["unlock", "play style-ambient-lounge"]);
  });

  it("plays horns or sleaze on the title, and keeps one already playing", () => {
    const { music, log } = setup();
    music.unlock();
    music.playTitle();
    music.playTitle();
    expect(log.filter((l) => l.startsWith("play"))).toEqual(["play blaxploitation-horns"]);
  });

  it("switches stages to a fresh random vibe and bosses to the boss loop", () => {
    const { music, log } = setup();
    music.unlock();
    music.switchToRandomStageTrack();
    music.switchToRandomStageTrack();
    music.switchToBossTrack();
    const plays = log.filter((l) => l.startsWith("play")).map((l) => l.slice(5));
    expect(plays[0]).not.toBe(plays[1]);
    expect(
      plays.slice(0, 2).every((id) => !["solitaire-boss", "style-ambient-lounge"].includes(id)),
    ).toBe(true);
    expect(plays[2]).toBe("solitaire-boss");
  });

  it("resumes the same stage track after settings", () => {
    const { music, log } = setup();
    music.unlock();
    music.switchToRandomStageTrack();
    const stage = log.at(-1);
    music.playSettings();
    music.resumeStage();
    expect(log.at(-1)).toBe(stage);
  });

  it("winds the music down like a record player", () => {
    const { music, log } = setup();
    music.unlock();
    music.switchToRandomStageTrack();
    music.windDown();
    expect(log.at(-1)).toBe("windDown undefined");
    expect(music.current).toBeNull();
    expect(music.woundDown).toBe(true);
  });

  it("remembers it is wound down: the next music winds up, then plays normally", () => {
    const { music, log } = setup();
    music.unlock();
    music.switchToRandomStageTrack();
    music.windDown();
    music.playTitle();
    expect(log.at(-1)).toBe("windUp blaxploitation-horns");
    expect(music.woundDown).toBe(false);
    music.playSettings();
    expect(log.at(-1)).toBe("play style-ambient-lounge");
  });

  it("winds back up what was playing before", () => {
    const { music, log } = setup();
    music.unlock();
    music.switchToRandomStageTrack();
    const stage = log.at(-1)!.slice(5);
    music.windDown();
    music.windUp();
    expect(log.at(-1)).toBe(`windUp ${stage}`);
  });
});
