import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { Registry } from "./core/registry";
import { baseDealer, dealerRegistry, type Dealer } from "./dealer";
import { GameSession } from "./game-session";
import { demoSessionConfig } from "./session-config";

const allCards = (state: ReturnType<Dealer["startGame"]>) => [
  ...state.field.map(({ block }) => block),
  ...state.hand,
  ...state.deck,
  ...state.discardPile,
];

describe("dealer", () => {
  it("starts with an empty field, a full hand and the rest in the deck", () => {
    const state = baseDealer.startGame(standardDeck, () => 0);
    expect(state.field).toHaveLength(0);
    expect(state.hand).toHaveLength(5);
    expect(state.deck).toHaveLength(47);
    expect(state.discardPile).toHaveLength(0);
    expect(new Set(allCards(state)).size).toBe(52);
  });

  it("places the first play at the centre without a target, using one play", () => {
    const state = baseDealer.startGame(standardDeck, () => 0);
    const first = baseDealer.play(state, { cardId: state.hand[0].id })!;
    expect(first.field).toEqual([{ block: state.hand[0], cell: { x: 0, y: 0, z: 0 } }]);
    expect(first.round.movesLeft).toBe(5);
    expect(baseDealer.play(first, { cardId: first.hand[0].id })).toBeNull();
  });

  it("allows a discard before the first play", () => {
    const state = baseDealer.startGame(standardDeck, () => 0);
    const discarded = baseDealer.discard(state, state.hand[0].id)!;
    expect(discarded.round.discardsLeft).toBe(3);
    expect(discarded.round.movesLeft).toBe(6);
    expect(discarded.field).toHaveLength(0);
  });

  it("moves a played card from hand to its legal field cell", () => {
    const opening = baseDealer.startGame(standardDeck, () => 0);
    const started = baseDealer.play(opening, { cardId: opening.hand[0].id })!;
    const state = baseDealer.refillHand(started, () => 0).state;
    const cardId = state.hand[0].id;
    const targetId = state.field[0].block.id;
    const played = baseDealer.play(state, { cardId, targetId, face: "east" })!;
    expect(played.field[1]).toEqual({ block: state.hand[0], cell: { x: 1, y: 0, z: 0 } });
    expect(played.hand).toHaveLength(4);
    expect(played.round.movesLeft).toBe(4);
    expect(state.hand).toHaveLength(5);
    expect(
      baseDealer.play(played, { cardId: played.hand[0].id, targetId, face: "east" }),
    ).toBeNull();
    expect(new Set(allCards(played)).size).toBe(52);
  });

  it("moves a discarded card into the discard pile and refills the hand", () => {
    const state = baseDealer.startGame(standardDeck, () => 0);
    const discarded = baseDealer.discard(state, state.hand[0].id)!;
    expect(discarded.discardPile).toEqual([state.hand[0]]);
    expect(discarded.hand).toHaveLength(4);
    expect(discarded.round.discardsLeft).toBe(3);
    const { state: refilled, drawn } = baseDealer.refillHand(discarded, () => 0);
    expect(drawn).toHaveLength(1);
    expect(refilled.hand).toHaveLength(5);
    expect(refilled.deck).toHaveLength(46);
    expect(new Set(allCards(refilled)).size).toBe(52);
    expect(baseDealer.refillHand({ ...discarded, deck: [] }).drawn).toHaveLength(0);
  });

  it("swaps to a registered boss dealer without replacing or altering GameState", () => {
    expect(dealerRegistry.get("base")).toBe(baseDealer);
    const boss: Dealer = {
      ...baseDealer,
      name: "no-discards",
      handSize: 3,
      canDiscard: () => false,
    };
    const registry = new Registry<Dealer>("dealer");
    registry.register(baseDealer.name, baseDealer);
    registry.register(boss.name, boss);
    const game = new GameSession(registry, demoSessionConfig, standardDeck, () => 0);
    const stateBefore = game.state;
    game.useDealer(boss.name);
    expect(game.state).toBe(stateBefore);
    expect(game.dealer).toBe(boss);
    expect(game.discard(stateBefore.hand[0].id)).toBeNull();
    expect(game.state).toBe(stateBefore);
    expect(game.refillHand()).toHaveLength(0);
    expect(game.state.hand).toHaveLength(5);
  });
});
