import { describe, expect, it } from "vite-plus/test";
import { loopOffset } from "./music-player";

describe("loopOffset", () => {
  const info = { tempo_bpm: 120, beats: 16, loop_seconds: 8, first_beat_seconds: 0.25 };

  it("places beat 0 on the loop's first downbeat", () => {
    expect(loopOffset(info, 0)).toBeCloseTo(0.25);
  });

  it("advances half a second per beat at 120 BPM and wraps at the loop end", () => {
    expect(loopOffset(info, 4)).toBeCloseTo(2.25);
    expect(loopOffset(info, 16)).toBeCloseTo(0.25);
    expect(loopOffset(info, 15.75)).toBeCloseTo(0.125);
  });

  it("handles negative beats", () => {
    expect(loopOffset(info, -1)).toBeCloseTo(7.75);
  });
});
