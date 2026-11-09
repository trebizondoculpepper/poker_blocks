import { describe, expect, it } from "vite-plus/test";
import { createHoldGesture, holdDelay, type HoldTimer } from "./hold-gesture";

/** A timer the test advances by hand. */
function manualTimer() {
  let pending: { callback: () => void; at: number } | null = null;
  let now = 0;
  const timer: HoldTimer = {
    start: (callback, delay) => (pending = { callback, at: now + delay }),
    stop: () => void (pending = null),
  };
  const advance = (ms: number) => {
    now += ms;
    if (pending && pending.at <= now) {
      const { callback } = pending;
      pending = null;
      callback();
    }
  };
  return { timer, advance };
}

describe("press and hold (#5)", () => {
  it("holds after the delay when the finger stays put, and the lift is not a tap", () => {
    const { timer, advance } = manualTimer();
    const hold = createHoldGesture(timer);
    let held = 0;
    hold.down(1, 100, 100, () => held++);
    hold.move(1, 104, 103);
    advance(holdDelay);
    expect(held).toBe(1);
    expect(hold.holding).toBe(true);
    expect(hold.up(1)).toBe(true);
    expect(hold.holding).toBe(false);
  });

  it("is a tap when lifted before the delay", () => {
    const { timer, advance } = manualTimer();
    const hold = createHoldGesture(timer);
    let held = 0;
    hold.down(1, 0, 0, () => held++);
    advance(holdDelay - 1);
    expect(hold.up(1)).toBe(false);
    advance(10);
    expect(held).toBe(0);
  });

  it("gives way to a drag once the finger moves past the slop", () => {
    const { timer, advance } = manualTimer();
    const hold = createHoldGesture(timer);
    let held = 0;
    hold.down(1, 0, 0, () => held++);
    hold.move(1, 30, 0);
    advance(holdDelay);
    expect(held).toBe(0);
    expect(hold.up(1)).toBe(false);
  });

  it("belongs to one finger: another pointer cannot move or lift it", () => {
    const { timer, advance } = manualTimer();
    const hold = createHoldGesture(timer);
    let held = 0;
    hold.down(1, 0, 0, () => held++);
    hold.move(2, 300, 300);
    expect(hold.up(2)).toBe(false);
    advance(holdDelay);
    expect(held).toBe(1);
  });

  it("is abandoned by a cancel or interruption", () => {
    const { timer, advance } = manualTimer();
    const hold = createHoldGesture(timer);
    let held = 0;
    hold.down(1, 0, 0, () => held++);
    hold.cancel();
    advance(holdDelay);
    expect(held).toBe(0);
    expect(hold.up(1)).toBe(false);
  });
});
