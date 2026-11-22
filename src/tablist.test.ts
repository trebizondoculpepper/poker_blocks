import { describe, expect, it } from "vite-plus/test";
import {
  isPanelCloseKey,
  isTabActivationKey,
  selectionAfterRemoval,
  tabFocusAfter,
} from "./tablist";

describe("tablist keyboard behaviour (#1378)", () => {
  it("moves focus along the row with the arrows, wrapping at both ends", () => {
    expect(tabFocusAfter("ArrowRight", 0, 3)).toBe(1);
    expect(tabFocusAfter("ArrowRight", 2, 3)).toBe(0);
    expect(tabFocusAfter("ArrowLeft", 0, 3)).toBe(2);
    expect(tabFocusAfter("ArrowDown", 1, 3)).toBe(2);
    expect(tabFocusAfter("ArrowUp", 1, 3)).toBe(0);
  });

  it("jumps to either end with Home and End", () => {
    expect(tabFocusAfter("Home", 2, 3)).toBe(0);
    expect(tabFocusAfter("End", 0, 3)).toBe(2);
  });

  it("leaves focus alone for any other key", () => {
    expect(tabFocusAfter("Tab", 1, 3)).toBeNull();
    expect(tabFocusAfter("a", 1, 3)).toBeNull();
    expect(tabFocusAfter("Enter", 1, 3)).toBeNull();
  });

  it("has nowhere to move with no tabs", () => {
    expect(tabFocusAfter("ArrowRight", 0, 0)).toBeNull();
    expect(tabFocusAfter("Home", 0, 0)).toBeNull();
  });

  it("activates on Enter or Space, and closes on Escape", () => {
    expect(isTabActivationKey("Enter")).toBe(true);
    expect(isTabActivationKey(" ")).toBe(true);
    expect(isTabActivationKey("ArrowRight")).toBe(false);
    expect(isPanelCloseKey("Escape")).toBe(true);
    expect(isPanelCloseKey("Enter")).toBe(false);
  });
});

describe("selection after the tabs change (#1378)", () => {
  it("keeps the same index while a tab is still there", () => {
    expect(selectionAfterRemoval(1, 3)).toBe(1);
  });

  it("falls back to the last tab when the list got shorter", () => {
    expect(selectionAfterRemoval(2, 1)).toBe(0);
    expect(selectionAfterRemoval(5, 2)).toBe(1);
  });

  it("selects nothing when no tab is left", () => {
    expect(selectionAfterRemoval(0, 0)).toBeNull();
  });
});
