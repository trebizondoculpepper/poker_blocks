import { describe, expect, it } from "vite-plus/test";
import { fitTaps, snapToLoop } from "./tap-tempo";

describe("fitTaps", () => {
  it("needs four taps", () => {
    expect(fitTaps([0, 0.5, 1])).toBeNull();
  });

  it("recovers the tempo from steady taps", () => {
    const taps = Array.from({ length: 12 }, (_, i) => 3 + i * 0.4); // 150 BPM
    expect(fitTaps(taps)!.bpm).toBeCloseTo(150);
    expect(fitTaps(taps)!.jitter).toBeCloseTo(0);
  });

  it("averages out human timing wobble", () => {
    const wobble = [0.02, -0.03, 0.01, 0.025, -0.015, -0.02, 0.03, -0.01, 0.0, 0.015];
    const taps = wobble.map((w, i) => i * 0.25 + w); // 240 BPM with +/-30 ms errors
    const fit = fitTaps(taps)!;
    expect(fit.bpm).toBeGreaterThan(235);
    expect(fit.bpm).toBeLessThan(245);
    expect(fit.jitter).toBeGreaterThan(0.01);
  });
});

describe("snapToLoop", () => {
  it("snaps to a whole number of bars and places beat 1 at the first tap", () => {
    // A 120 s loop tapped at about 201 BPM: 100.5 bars -> 100 or 101 bars.
    const snapped = snapToLoop(201, 120, 1.3);
    expect(snapped.beats % 4).toBe(0);
    expect(Math.abs(snapped.tempo_bpm - 201)).toBeLessThan(1.5);
    expect(snapped.first_beat_seconds).toBeCloseTo(1.3 % ((4 * 60) / snapped.tempo_bpm), 3);
  });

  it("handles taps that start after the loop has wrapped", () => {
    const snapped = snapToLoop(120, 60, 61.5); // 120 bars-worth; 61.5 s is 1.5 s into the loop
    expect(snapped.beats).toBe(120);
    expect(snapped.first_beat_seconds).toBeCloseTo(1.5);
  });
});
