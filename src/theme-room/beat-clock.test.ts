import { describe, expect, it } from "vite-plus/test";
import { createBeatClock } from "./beat-clock";

describe("beat clock", () => {
  it("counts beats at a steady tempo", () => {
    const clock = createBeatClock(10, 120);
    expect(clock.beatAt(10)).toBe(0);
    expect(clock.beatAt(12)).toBeCloseTo(4);
    expect(clock.timeOfBeat(8)).toBeCloseTo(14);
  });

  it("integrates a linear tempo glide and then holds the new tempo", () => {
    const clock = createBeatClock(0, 120);
    clock.ramp(2, 4, 180); // beat 4 at t=2, then 120 -> 180 BPM over 4 s
    // Average 150 BPM over the 4 s glide adds 10 beats.
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
    expect(clock.tempoAt(1.5)).toBeCloseTo(110);
  });
});
