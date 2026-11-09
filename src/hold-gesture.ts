/**
 * Press and hold, the touch path to a block's inspection text (issue #5). A finger that stays
 * within `slop` pixels of where it went down for `delay` milliseconds "holds"; moving further,
 * lifting first or a cancel abandons it. Tied to one pointer id; a second finger never
 * completes another finger's hold. Pure state with an injected timer, so it can be tested.
 */
export type HoldTimer = {
  start(callback: () => void, delay: number): unknown;
  stop(handle: unknown): void;
};

export type HoldGesture = {
  /** A finger went down; `onHold` runs if it stays put long enough. */
  down(pointerId: number, x: number, y: number, onHold: () => void): void;
  /** The finger moved; moving past the slop abandons the hold. */
  move(pointerId: number, x: number, y: number): void;
  /** The finger lifted: whether that press was a hold (so it must not also tap). */
  up(pointerId: number): boolean;
  /** Abandon any pending hold (cancel, a second finger, interruption). */
  cancel(): void;
  /** Whether the current press has already become a hold. */
  readonly holding: boolean;
};

export const holdDelay = 450;
/** The same distance at which a hand or board drag begins, so a press is either one or the other. */
export const holdSlop = 8;

export function createHoldGesture(
  timer: HoldTimer = {
    start: (callback, delay) => window.setTimeout(callback, delay),
    stop: (handle) => window.clearTimeout(handle as number),
  },
  delay = holdDelay,
  slop = holdSlop,
): HoldGesture {
  let press: { pointerId: number; x: number; y: number; handle: unknown; held: boolean } | null =
    null;
  const cancel = () => {
    if (press && !press.held) timer.stop(press.handle);
    press = null;
  };
  return {
    down(pointerId, x, y, onHold) {
      cancel();
      const handle = timer.start(() => {
        if (press?.pointerId !== pointerId) return;
        press.held = true;
        onHold();
      }, delay);
      press = { pointerId, x, y, handle, held: false };
    },
    move(pointerId, x, y) {
      if (press?.pointerId !== pointerId || press.held) return;
      if (Math.hypot(x - press.x, y - press.y) > slop) cancel();
    },
    up(pointerId) {
      if (press?.pointerId !== pointerId) return false;
      const held = press.held;
      cancel();
      return held;
    },
    cancel,
    get holding() {
      return press?.held ?? false;
    },
  };
}
