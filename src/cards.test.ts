import { describe, expect, it } from "vite-plus/test";
import { cardName, ranks, standardDeck, suits } from "./cards";
import { drawCards } from "./deal";
import { baseDealer } from "./dealer";
import { toggleBlockSelection } from "./block-trait-behaviours";

describe("standard deck", () => {
  it("contains each of the 52 rank and suit combinations once", () => {
    expect(standardDeck).toHaveLength(52);
    expect(
      new Set(
        standardDeck.map(({ traits: { identity } }) => `${identity.rank}-${identity.suit.name}`),
      ).size,
    ).toBe(52);
    for (const suit of suits) {
      expect(
        standardDeck
          .filter((block) => block.traits.identity.suit === suit)
          .map((block) => block.traits.identity.rank),
      ).toEqual(ranks);
    }
  });

  it("names the card represented by a block", () => {
    expect(cardName({ rank: "3", suit: suits[1] })).toBe("3 of Hearts");
    expect(cardName({ rank: "K", suit: suits[1] })).toBe("King of Hearts");
  });

  it("draws a featured block and a distinct six-block hand", () => {
    const firstDraw = drawCards(standardDeck, 1, () => 0);
    const secondDraw = drawCards(firstDraw.deck, baseDealer.handSize, () => 0);
    expect(firstDraw.cards).toHaveLength(1);
    expect(secondDraw.cards).toHaveLength(6);
    expect(secondDraw.deck).toHaveLength(45);
    expect(new Set([...firstDraw.cards, ...secondDraw.cards]).size).toBe(7);
    expect(secondDraw.cards.every((block) => !secondDraw.deck.includes(block))).toBe(true);
    expect(standardDeck).toHaveLength(52);
  });

  it("toggles multiple selectable blocks independently", () => {
    const [featured, handCard] = standardDeck;
    const one = toggleBlockSelection(new Set(), featured);
    const two = toggleBlockSelection(one, handCard);
    expect([...two]).toEqual([featured.id, handCard.id]);
    expect([...toggleBlockSelection(two, featured)]).toEqual([handCard.id]);
    expect(
      toggleBlockSelection(two, {
        ...featured,
        traits: { identity: featured.traits.identity },
      }),
    ).toBe(two);
  });
});
