import { describe, expect, it } from "vite-plus/test";
import { blockMaterials, makeDevDeck, materialOf } from "./materials";
import { standardDeck } from "./cards";

describe("dev room deck", () => {
  it("keeps all 52 unique cards and distributes every prototype material", () => {
    const deck = makeDevDeck(42);
    expect(deck.map(({ id }) => id)).toEqual(standardDeck.map(({ id }) => id));
    expect(new Set(deck.map(materialOf))).toEqual(new Set(blockMaterials));
    expect(deck.every(({ traits }) => traits.inspectable?.inspect().includes(" · "))).toBe(true);
    expect(standardDeck.every((block) => materialOf(block) === "paper")).toBe(true);
  });

  it("reconstructs the same materials from a seed", () => {
    expect(makeDevDeck(123).map(materialOf)).toEqual(makeDevDeck(123).map(materialOf));
    expect(makeDevDeck(123).map(materialOf)).not.toEqual(makeDevDeck(124).map(materialOf));
  });
});
