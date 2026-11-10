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
    for (const effect of soundEffects) expect(effect.description.trim()).not.toBe("");
  });

  it("names each sound and puts it in a family", () => {
    for (const effect of soundEffects) {
      expect(effect.name.trim(), effect.id).not.toBe("");
      expect(effect.family, effect.id).toMatch(/^[a-z]+$/);
    }
  });

  it("only uses registered sounds with audio of their own as stand-ins", () => {
    const byId = new Map(soundEffects.map((effect) => [effect.id, effect]));
    for (const { id, placeholder } of soundEffects) {
      if (!placeholder) continue;
      expect(byId.has(placeholder), `${id} → ${placeholder}`).toBe(true);
      expect(placeholder, id).not.toBe(id);
      const standIn = byId.get(placeholder)!;
      expect(
        sfxFileNames(standIn).some((name) => files.includes(name)),
        `${placeholder} has audio`,
      ).toBe(true);
    }
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
