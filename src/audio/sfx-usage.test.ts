import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { soundEffects } from "./sfx-registry";
import { formatSfxUsage, scanSfxUsage } from "../../scripts/sfx-usage-scan";

describe("sound usage record", () => {
  it("is up to date: run `npm run sfx:usage` after adding, removing or moving a sound", () => {
    const recorded = readFileSync(new URL("./sfx-usage.json", import.meta.url), "utf8");
    expect(recorded).toBe(formatSfxUsage(scanSfxUsage()));
  });

  it("has an entry for every registered sound, and nothing else", () => {
    const usage = scanSfxUsage();
    expect(Object.keys(usage).sort()).toEqual(soundEffects.map(({ id }) => id).sort());
  });

  it("counts a placeholder as a use of the sound it stands in for", () => {
    const usage = scanSfxUsage();
    const standIns = soundEffects.filter(({ placeholder }) => placeholder);
    for (const { placeholder } of standIns) expect(usage[placeholder!]!.uses).toBeGreaterThan(0);
  });
});
