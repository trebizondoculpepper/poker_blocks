import { describe, expect, it } from "vite-plus/test";
import { sfxFileNames, soundEffects } from "./sfx-registry";

const files = Object.keys(import.meta.glob("../assets/sfx/*.mp3")).map((path) =>
  path.slice(path.lastIndexOf("/") + 1),
);

describe("sound-effect registry", () => {
  it("has unique ids", () => {
    const ids = soundEffects.map((effect) => effect.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses lowercase dotted ids", () => {
    for (const effect of soundEffects) expect(effect.id).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
  });

  it("describes when each sound plays", () => {
    for (const effect of soundEffects) expect(effect.trigger.trim()).not.toBe("");
  });

  it("keeps durations within the generator's range", () => {
    for (const { durationSeconds } of soundEffects) {
      if (durationSeconds === undefined) continue;
      expect(durationSeconds).toBeGreaterThanOrEqual(0.5);
      expect(durationSeconds).toBeLessThanOrEqual(30);
    }
  });

  // Missing audio is allowed: new entries play silently until `npm run sfx` is run.
  it("has no audio files outside the registry", () => {
    const known = new Set(soundEffects.flatMap(sfxFileNames));
    expect(files.filter((name) => !known.has(name))).toEqual([]);
  });
});
