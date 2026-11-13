import { describe, expect, it, vi } from "vite-plus/test";
import { standardDeck } from "./cards";
import { popCards, shuffleCards } from "./deal";
import { baseDealer } from "./dealer";
import { GameRun } from "./game-run";
import { Registry } from "./core/registry";
import type { Dealer } from "./dealer";
import type { GameState } from "./game-state";

const ids = (cards: readonly { id: string }[]) => cards.map(({ id }) => id);

describe("ordered deck (#551, #836)", () => {
  it("pops from the front, in order, leaving the rest in order", () => {
    const first = popCards(standardDeck, 2);
    const second = popCards(first.deck, 3);
    expect(ids(first.cards)).toEqual(ids(standardDeck.slice(0, 2)));
    expect(ids(second.cards)).toEqual(ids(standardDeck.slice(2, 5)));
    expect(ids(second.deck)).toEqual(ids(standardDeck.slice(5)));
    // The same instances move: identity, material and state go with them.
    expect(first.cards[0]).toBe(standardDeck[0]);
  });

  it("an empty pop moves nothing, and a count the deck can't supply moves nothing", () => {
    expect(popCards([], 0)).toEqual({ cards: [], deck: [] });
    expect(() => popCards(standardDeck.slice(0, 2), 3)).toThrow(RangeError);
  });

  it("shuffles the same instances, deterministically for a given random stream", () => {
    const stream = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const once = shuffleCards(standardDeck, stream(7));
    const again = shuffleCards(standardDeck, stream(7));
    expect(ids(once)).toEqual(ids(again));
    expect(ids(once)).not.toEqual(ids(standardDeck));
    expect(new Set(once)).toEqual(new Set(standardDeck));
    expect(once).toHaveLength(standardDeck.length);
  });

  it("refilling the hand pops the top cards and never draws on the random stream", () => {
    const random = vi.fn(() => 0.5);
    const state = baseDealer.startGame(standardDeck, random);
    const shuffles = random.mock.calls.length;
    expect(shuffles).toBeGreaterThan(0);
    const discarded = baseDealer.discard(state, state.hand[0]!.id)!;
    const { drawn, state: refilled } = baseDealer.refillHand(discarded);
    expect(random.mock.calls.length).toBe(shuffles);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.id).toBe(discarded.deck[0]!.id);
    expect(ids(refilled.deck)).toEqual(ids(discarded.deck.slice(1)));
  });

  it("shuffles once as a stage starts, then the hand is the top of that order", () => {
    const random = vi.fn(() => 0.25);
    const empty: GameState = {
      field: [],
      hand: [],
      deck: [...standardDeck],
      discardPile: [],
      passiveRack: [],
      coins: 0,
      round: { score: 0, targetScore: 0, movesLeft: 0, discardsLeft: 0 },
    };
    const started = baseDealer.startStage(empty, { targetScore: 1, plays: 1, discards: 1 }, random);
    const expected = shuffleCards(standardDeck, () => 0.25);
    expect(ids(started.hand)).toEqual(ids(expected.slice(0, baseDealer.handSize)));
    expect(ids(started.deck)).toEqual(ids(expected.slice(baseDealer.handSize)));
    expect(random).toHaveBeenCalledTimes(standardDeck.length - 1);
  });

  it("a new run shuffles its opening deck once, and the hand is the top of that order (#837 review)", () => {
    const dealers = new Registry<Dealer>("dealer");
    dealers.register(baseDealer.name, baseDealer);
    const random = vi.fn(() => 0.25);
    const run = new GameRun(
      dealers,
      {
        stage: () => ({ dealer: "base", targetScore: 100, plays: 3, discards: 2 }),
        handAtStageEnd: "return-to-deck",
        discardPileAfterShop: "keep-out",
      },
      standardDeck,
      random,
    );
    expect(random).toHaveBeenCalledTimes(standardDeck.length - 1);
    const expected = shuffleCards(standardDeck, () => 0.25);
    expect(ids(run.state.hand)).toEqual(ids(expected.slice(0, baseDealer.handSize)));
    expect(ids(run.state.deck)).toEqual(ids(expected.slice(baseDealer.handSize)));
    expect(run.state.round.movesLeft).toBe(3);
  });
});
