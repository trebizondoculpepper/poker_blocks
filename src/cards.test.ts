import { describe, expect, it } from "vite-plus/test";
import { cardName, deck, ranks, suits } from "./cards";

describe("standard deck", () => {
  it("contains each of the 52 rank and suit combinations once", () => {
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(({ rank, suit }) => `${rank}-${suit.name}`)).size).toBe(52);
    for (const suit of suits) {
      expect(deck.filter((card) => card.suit === suit).map((card) => card.rank)).toEqual(ranks);
    }
  });

  it("names the card represented by a block", () => {
    expect(cardName({ rank: "3", suit: suits[1] })).toBe("3 of hearts");
  });
});
