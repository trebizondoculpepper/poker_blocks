import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { refillHand } from "./dealer";

describe("dealer", () => {
  it("refills the hand from the remaining deck without duplicates", () => {
    const hand = standardDeck.slice(0, 4);
    const deck = standardDeck.slice(4);
    const result = refillHand(deck, hand, () => 0);
    expect(result.hand).toHaveLength(5);
    expect(result.drawn).toEqual([standardDeck[4]]);
    expect(result.deck).toHaveLength(47);
    expect(new Set([...result.hand, ...result.deck]).size).toBe(52);
  });

  it("stops drawing when the deck is empty", () => {
    expect(refillHand([], standardDeck.slice(0, 4)).hand).toHaveLength(4);
  });
});
