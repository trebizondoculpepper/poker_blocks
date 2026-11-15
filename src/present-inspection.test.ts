import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import {
  getMaterialDefinition,
  makeDevDeck,
  materialOf,
  materialPools,
  withMaterial,
} from "./materials";
import "./playable-payload";
import { createPresent, storedPlayable } from "./present";
import { inspectBlock } from "./traits/inspectable";

describe("unopened Present inspection and the wrapper material (#1421)", () => {
  it("inspects as a Present: no rank, suit, material or bonus of its contents", () => {
    const inside = withMaterial(standardDeck[6]!, getMaterialDefinition("gold"));
    const text = inspectBlock(createPresent("p1", storedPlayable(inside)))!;
    expect(text.startsWith("Present")).toBe(true);
    expect(text).not.toMatch(/7|Seven|Spades|spades|Gold|gold/);
    expect(text).not.toMatch(/no stored contents/);
  });

  it("weighs exactly its stored contents, through the shared weight line", () => {
    const inside = withMaterial(standardDeck[6]!, getMaterialDefinition("gold"));
    expect(inspectBlock(createPresent("p1", storedPlayable(inside)))).toMatch(/Weight: 19\.3 kg/);
  });

  it("is never dealt as a plain card's material by any pool", () => {
    for (const pool of materialPools.names())
      expect(
        materialPools
          .get(pool)()
          .map(({ id }) => id),
      ).not.toContain("giftWrap");
    for (const seed of [1, 2, 3, 4])
      expect(makeDevDeck(seed, "registered").map(materialOf)).not.toContain("giftWrap");
  });
});
