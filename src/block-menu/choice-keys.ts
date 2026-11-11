/**
 * What a block menu's hidden choice buttons do (#528), as plain functions so they can be tested
 * without a DOM: the buttons are the keyboard and screen-reader path, and each one drives its
 * cube's own `input.*` events, so activation, sounds and refusals stay the cube's.
 */
import type { Block } from "../core/block";

/** How far the arrow keys move focus along the row; any other key doesn't move it. */
const steps: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/** The index focus moves to from `index` on `key` among `count` choices, or null. */
export function focusAfter(key: string, index: number, count: number): number | null {
  const step = steps[key];
  return step === undefined || count === 0 ? null : (index + step + count) % count;
}

/** What the buttons' events do to a cube (it may not be built yet). */
export const choiceActions = {
  focus: (cube: Block | undefined) => cube?.emit("input.focus"),
  blur: (cube: Block | undefined) => cube?.emit("input.blur"),
  /** Activating the button is a complete press on its cube. */
  activate(cube: Block | undefined) {
    cube?.emit("input.press");
    cube?.emit("input.release");
  },
};

/** Whether a key asks to go back (close the dialog), when the dialog offers a way back. */
export const isBackKey = (key: string): boolean => key === "Escape";
