import { describe, expect, it } from "vite-plus/test";
import type { CardBlock } from "./cards";
import { standardDeck } from "./cards";
import {
  blockCanDrag,
  blockCursor,
  blockHighlighted,
  needsLandingHandover,
  registerBlockTrait,
  toggleBlockSelection,
} from "./block-trait-behaviours";

describe("registered block trait behavior", () => {
  it("adds a test-only capability without changing a caller", () => {
    const block = {
      ...standardDeck[0],
      traits: { identity: standardDeck[0].traits.identity, testPulse: { cursor: "crosshair" } },
    } as CardBlock;
    const unregister = registerBlockTrait("testPulse", {
      cursor: (config) => (config as { cursor: string }).cursor,
      canDrag: () => true,
      handover: () => true,
      highlight: () => true,
    });
    try {
      expect(blockCursor(block)).toBe("crosshair");
      expect(blockCanDrag(block)).toBe(true);
      expect(needsLandingHandover(block)).toBe(true);
      expect(blockHighlighted(block, new Set())).toBe(true);
      expect(toggleBlockSelection(new Set(), block)).toEqual(new Set());
    } finally {
      unregister();
    }
    expect(blockCursor(block)).toBe("default");
  });
});
