import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

// Every loop's sidecar carries what the beat signal needs (#257): a whole number of bars of
// `beats_per_bar` beats, a tempo that fits the loop exactly, and where beat 1 falls.
const folder = join(import.meta.dirname, "../../music/loops");
const sidecars = readdirSync(folder)
  .filter((name) => name.endsWith("-loop.json"))
  .map((name) => ({ name, data: JSON.parse(readFileSync(join(folder, name), "utf8")) }));

describe("music loop beat data (#257)", () => {
  it("finds the loops", () => {
    expect(sidecars.length).toBeGreaterThanOrEqual(25);
  });

  it.each(sidecars)(
    "$name has a whole-bar beat grid, a fitting tempo and a first beat",
    ({ data }) => {
      expect(Number.isInteger(data.beats)).toBe(true);
      expect(Number.isInteger(data.bars)).toBe(true);
      expect(data.beats).toBe(data.bars * data.beats_per_bar);
      expect(data.tempo_bpm).toBeCloseTo((data.beats * 60) / data.loop_seconds, 2);
      expect(data.tempo_bpm).toBeGreaterThanOrEqual(60);
      expect(data.tempo_bpm).toBeLessThanOrEqual(180);
      expect(data.first_beat_seconds).toBeGreaterThanOrEqual(0);
      expect(data.first_beat_seconds).toBeLessThan((60 / data.tempo_bpm) * data.beats_per_bar);
    },
  );
});
