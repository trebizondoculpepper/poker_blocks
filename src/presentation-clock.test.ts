import { describe, expect, it } from "vite-plus/test";
import { createPresentationClock } from "./presentation-clock";

describe("the presentation clock (#530)", () => {
  it("follows frame time until held, stands still while held, and resumes without a jump", () => {
    const clock = createPresentationClock();
    expect(clock.advance(1000, 0.016)).toEqual({ time: 1000, delta: 0.016 });
    const release = clock.hold();
    expect(clock.advance(1100, 0.016)).toEqual({ time: 1000, delta: 0 });
    expect(clock.advance(1500, 0.016)).toEqual({ time: 1000, delta: 0 });
    release();
    expect(clock.advance(1516, 0.016)).toEqual({ time: 1016, delta: 0.016 });
  });

  it("nests holds, and a release called twice counts once", () => {
    const clock = createPresentationClock();
    clock.advance(0, 0);
    const first = clock.hold();
    const second = clock.hold();
    first();
    first();
    expect(clock.advance(100, 0.1).delta).toBe(0);
    second();
    expect(clock.advance(200, 0.1).delta).toBe(0.1);
  });
});
