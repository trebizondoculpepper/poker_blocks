import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { registerOfferKind, type OfferBlock } from "./offer-kinds";
import { demoRunRules } from "./run-rules";
import { fromSaveRecord, toSaveRecord } from "./save";

/**
 * A test-only kind of offer (#67): a pouch that pays coins into the run when bought. Registered
 * here and nowhere else, it shows a new offer kind needs no edit to the game run or the save.
 */
type Pouch = OfferBlock & { coins: number };
registerOfferKind<Pouch>("test-pouch", {
  destination: "hand",
  price: () => 2,
  receive: (state, block) => ({ ...state, coins: state.coins + block.coins }),
  unbought: (state) => state,
  save: (block) => ({ kind: "test-pouch", id: block.id, coins: block.coins }),
  restore: (saved) => ({ id: String(saved.id), coins: Number(saved.coins) }),
});

/** A run standing in a shop that stocks one pouch, with `coins` to spend. */
function shopWithPouch(coins: number): GameRun {
  const run = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0);
  run.forceOutcome("won");
  run.advance();
  const snapshot = run.snapshot();
  return GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, {
    ...snapshot,
    state: {
      ...snapshot.state,
      coins,
      shopStock: [{ kind: "test-pouch", block: { id: "pouch.1", coins: 10 } as Pouch }],
    },
  });
}

describe("offer kinds (#67)", () => {
  it("prices, buys and pays out a kind registered only in this test", () => {
    const run = shopWithPouch(3);
    expect(run.buyShopOffer("pouch.1", "passive-rack")).toBeNull();
    expect(run.buyShopOffer("pouch.1", "hand")?.block.id).toBe("pouch.1");
    // Paid 2 coins for a pouch holding 10.
    expect(run.state.coins).toBe(11);
    expect(run.state.shopStock).toEqual([]);
  });

  it("refuses it when the run can't afford it, and says so before the attempt", () => {
    const run = shopWithPouch(1);
    // The shop asks first, so a refusal for want of coins gets its own sound.
    expect(run.canAfford("pouch.1")).toBe(false);
    expect(run.buyShopOffer("pouch.1", "hand")).toBeNull();
    expect(run.state.coins).toBe(1);
    expect(shopWithPouch(2).canAfford("pouch.1")).toBe(true);
    expect(shopWithPouch(2).canAfford("no-such-offer")).toBe(false);
  });

  it("saves and restores it through its own kind", () => {
    const run = shopWithPouch(3);
    const record = JSON.parse(JSON.stringify(toSaveRecord(run.snapshot())));
    expect(record.state.shopStock).toEqual([{ kind: "test-pouch", id: "pouch.1", coins: 10 }]);
    const restored = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    expect(restored.state.shopStock).toEqual([
      { kind: "test-pouch", block: { id: "pouch.1", coins: 10 } },
    ]);
  });

  it("rejects a save naming an unknown kind", () => {
    const record = JSON.parse(JSON.stringify(toSaveRecord(shopWithPouch(3).snapshot())));
    record.state.shopStock = [{ kind: "no-such-kind", id: "x" }];
    expect(fromSaveRecord(record, standardDeck, dealerRegistry)).toBeNull();
  });

  it("leaves the shop with the kind deciding what happens to it unbought", () => {
    const run = shopWithPouch(3);
    expect(run.leaveShop()).toBe(true);
    expect(run.state.shopStock).toBeUndefined();
    expect(run.state.coins).toBe(3);
  });
});
