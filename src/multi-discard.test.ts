import { describe, expect, it } from "vite-plus/test";
import { fixedRandom } from "./random";
import { standardDeck } from "./cards";
import { Registry } from "./core/registry";
import { baseDealer, dealerRegistry, type Dealer } from "./dealer";
import { GameRun } from "./game-run";
import { fromSaveRecord, toSaveRecord } from "./save";
import { demoRunRules } from "./run-rules";
import { fillSlots } from "./zones";

function session(handSize = 5) {
  const dealer: Dealer = { ...baseDealer, name: "base", handSize };
  const dealers = new Registry<Dealer>("dealer");
  dealers.register(dealer.name, dealer);
  return new GameRun(
    dealers,
    {
      stage: () => ({ dealer: "base", targetScore: 100, plays: 3, discards: 2 }),
      handAtStageEnd: "return-to-deck",
      discardPileAfterShop: "keep-out",
    },
    standardDeck,
    () => 0,
  );
}

describe("fillSlots", () => {
  it("fills each gap in slot order and keeps the rest in place", () => {
    expect(fillSlots(["a", "c", "e"], [1, 3], ["X", "Y"])).toEqual(["a", "X", "c", "Y", "e"]);
  });
  it("closes gaps it cannot fill and appends extra draws", () => {
    expect(fillSlots(["a", "c"], [1, 2], ["X"])).toEqual(["a", "X", "c"]);
    expect(fillSlots(["a"], [0], ["X", "Y"])).toEqual(["X", "a", "Y"]);
  });
});

describe("discarding several blocks at once", () => {
  it("uses one discard for the whole selection, then appends replacements", () => {
    const game = session();
    const [a, b, c, d, e] = game.state.hand;
    expect(game.discard([b.id, d.id])).not.toBeNull();
    expect(game.state.round.discardsLeft).toBe(1);
    expect(game.state.discardPile).toEqual([b, d]);
    const drawn = game.refillHand();
    expect(game.state.hand).toEqual([a, c, e, ...drawn]);
  });

  it("refills up to the dealer's hand size, not a fixed five", () => {
    const game = session(7);
    expect(game.state.hand).toHaveLength(7);
    game.discard(game.state.hand.slice(0, 3).map(({ id }) => id));
    game.refillHand();
    expect(game.state.hand).toHaveLength(7);
  });

  it("is refused with no discards left, or with a card not in the hand", () => {
    const game = session();
    game.discard(game.state.hand[0].id);
    game.refillHand();
    game.discard(game.state.hand[0].id);
    game.refillHand();
    const before = game.state;
    expect(game.discard([before.hand[0].id, before.hand[1].id])).toBeNull();
    expect(game.state).toBe(before);
    const fresh = session();
    expect(fresh.discard([fresh.state.hand[0].id, "not-a-card"])).toBeNull();
    expect(fresh.discard([])).toBeNull();
  });

  it("survives a save and Continue", () => {
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0);
    const discards = game.state.round.discardsLeft;
    game.discard(game.state.hand.slice(0, 2).map(({ id }) => id));
    game.refillHand();
    const record = JSON.parse(JSON.stringify(toSaveRecord(game.snapshot())));
    const snapshot = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    const restored = GameRun.fromSnapshot(
      dealerRegistry,
      demoRunRules,
      standardDeck,
      snapshot,
      fixedRandom(),
    );
    expect(restored.snapshot()).toEqual(game.snapshot());
    expect(restored.state.discardPile).toHaveLength(2);
    expect(restored.state.round.discardsLeft).toBe(discards - 1);
  });
});
