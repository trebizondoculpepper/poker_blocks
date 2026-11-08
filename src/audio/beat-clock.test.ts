import { describe, expect, it } from "vite-plus/test";
import { createBeatClock, easedArea } from "./beat-clock";

describe("beat clock", () => {
  it("counts beats at a steady tempo", () => {
    const clock = createBeatClock(10, 120);
    expect(clock.beatAt(10)).toBe(0);
    expect(clock.beatAt(12)).toBeCloseTo(4);
    expect(clock.timeOfBeat(8)).toBeCloseTo(14);
  });

  it("integrates an eased tempo change and then holds the new tempo", () => {
    const clock = createBeatClock(0, 120);
    clock.ramp(2, 4, 180); // beat 4 at t=2, then ease 120 -> 180 BPM over 4 s
    // The ease is symmetric, so it averages 150 BPM and adds 10 beats.
    expect(clock.beatAt(6)).toBeCloseTo(14);
    expect(clock.tempoAt(4)).toBeCloseTo(150);
    expect(clock.beatAt(8)).toBeCloseTo(20); // then 180 BPM: 6 more beats in 2 s
    expect(clock.timeOfBeat(14)).toBeCloseTo(6);
  });

  it("keeps beats continuous when a new glide starts mid-glide", () => {
    const clock = createBeatClock(0, 100);
    clock.ramp(1, 2, 140);
    const before = clock.beatAt(1.5);
    clock.ramp(1.5, 1, 90);
    expect(clock.beatAt(1.5)).toBeCloseTo(before);
    // Eased, not linear: a quarter of the way in, tempo has moved 1/16 of the way.
    expect(clock.tempoAt(1.5)).toBeCloseTo(102.5);
  });

  it("holds a tempo with a zero-length ramp, then eases later", () => {
    const clock = createBeatClock(0, 120);
    clock.ramp(1, 0, 120);
    clock.ramp(3, 5, 100);
    expect(clock.tempoAt(2.9)).toBe(120);
    expect(clock.tempoAt(5.5)).toBeCloseTo(110);
    expect(clock.tempoAt(9)).toBe(100);
    // Beats are continuous across the hold and the ease.
    expect(clock.beatAt(3)).toBeCloseTo(6);
    expect(clock.beatAt(8)).toBeCloseTo(6 + (5 * 110) / 60);
  });

  it("integrates easeInOutCubic exactly", () => {
    // Numerical check of the closed form against a fine Riemann sum.
    let sum = 0;
    const n = 100000;
    for (let i = 0; i < n; i++) {
      const p = (i + 0.5) / n;
      sum += (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2) / n;
    }
    expect(easedArea(1)).toBeCloseTo(sum, 6);
    expect(easedArea(0.5)).toBeCloseTo(0.0625);
  });

  it("re-anchors to a new beat and tempo", () => {
    const clock = createBeatClock(0, 120);
    clock.rebase(10, 3.5, 90);
    expect(clock.beatAt(10)).toBeCloseTo(3.5);
    expect(clock.beatAt(12)).toBeCloseTo(6.5);
    expect(clock.tempoAt(11)).toBe(90);
  });
});
