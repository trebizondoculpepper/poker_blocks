import { describe, expect, it } from "vite-plus/test";
import { defaultMusicPlan, pickTrack, stagePool } from "./music-plan";

const all = [
  "take2",
  "blaxploitation-horns",
  "stripped-sleaze",
  "style-noir",
  "style-ambient-lounge",
  "solitaire-boss",
  "solitaire-jazz-funk",
];

describe("music plan", () => {
  it("plays horns or sleaze on the title screen", () => {
    expect(pickTrack("title", all, () => 0)).toBe("blaxploitation-horns");
    expect(pickTrack("title", all, () => 0.99)).toBe("stripped-sleaze");
  });

  it("reserves the boss and settings tracks", () => {
    expect(pickTrack("boss", all)).toBe(defaultMusicPlan.boss);
    expect(pickTrack("settings", all)).toBe(defaultMusicPlan.settings);
    expect(stagePool(all)).not.toContain(defaultMusicPlan.boss);
    expect(stagePool(all)).not.toContain(defaultMusicPlan.settings);
  });

  it("gives stages a random vibe from the pool, avoiding an immediate repeat", () => {
    const pool = stagePool(all);
    for (let i = 0; i < 20; i++) {
      const pick = pickTrack("stage", all, () => i / 20, "take2");
      expect(pool).toContain(pick);
      expect(pick).not.toBe("take2");
    }
  });

  it("returns null when a reserved track is missing", () => {
    expect(pickTrack("boss", ["take2"])).toBeNull();
    expect(pickTrack("title", ["take2"])).toBeNull();
  });
});
