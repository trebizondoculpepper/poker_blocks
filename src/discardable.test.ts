import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { baseDealer } from "./dealer";
import { devRanklessActive } from "./dev-rankless-active";
import { discardBehaviours, discardRefusal } from "./discardable";
import type { GameState } from "./game-state";

const state = (hand: CardBlock[]): GameState => ({
  field: [],
  hand,
  deck: [],
  discardPile: [],
  passiveRack: [],
  coins: 0,
  round: { score: 0, targetScore: 10, movesLeft: 3, discardsLeft: 2 },
});
const refusing = (id: string): CardBlock => ({
  ...standardDeck[5]!,
  id,
  traits: {
    ...standardDeck[5]!.traits,
    discardable: { behaviour: "refuse", config: { reason: "bound" } },
  },
});

describe("the discardable capability (#574)", () => {
  it("lets an ordinary card and a rankless active discard through the same behaviour", () => {
    expect(discardRefusal(standardDeck[0]!)).toBeNull();
    expect(discardRefusal(devRanklessActive("r"))).toBeNull();
    const rankless = devRanklessActive("r");
    const next = baseDealer.discard(state([standardDeck[0]!, rankless]), ["r"])!;
    expect(next.discardPile.map(({ id }) => id)).toEqual(["r"]);
    // Discarded, not opened or changed: the same instance.
    expect(next.discardPile[0]).toBe(rankless);
    expect(next.round.discardsLeft).toBe(1);
  });

  it("refuses a group containing a refusing card, changing nothing", () => {
    const before = state([standardDeck[0]!, refusing("bound-1")]);
    expect(discardRefusal(refusing("bound-1"))).toBe("bound");
    expect(baseDealer.discard(before, [standardDeck[0]!.id, "bound-1"])).toBeNull();
  });

  it("keeps ordinary discards exactly as before, in hand order", () => {
    const hand = [standardDeck[0]!, standardDeck[1]!, standardDeck[2]!];
    const next = baseDealer.discard(state(hand), [standardDeck[2]!.id, standardDeck[0]!.id])!;
    expect(next.discardPile.map(({ id }) => id)).toEqual([
      standardDeck[0]!.id,
      standardDeck[2]!.id,
    ]);
    expect(next.hand.map(({ id }) => id)).toEqual([standardDeck[1]!.id]);
  });

  it("dispatches by registered behaviour name", () => {
    expect(discardBehaviours.has("ordinary")).toBe(true);
    expect(() =>
      discardRefusal({ ...standardDeck[0]!, traits: { discardable: { behaviour: "nope" } } }),
    ).toThrow();
  });
});
