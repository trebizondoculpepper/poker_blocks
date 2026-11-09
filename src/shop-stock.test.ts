import { describe, expect, it } from "vite-plus/test";
import type { PassiveBlock } from "./passives";
import type { CardBlock } from "./cards";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { fromSaveRecord, toSaveRecord } from "./save";
import { demoRunRules } from "./run-rules";
import { shopPreviewState } from "./shop-stock";

function shop() {
  const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
  return GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, {
    ...game.snapshot(),
    phase: "shop",
    // Enough coins for any passive's base price (#144).
    state: shopPreviewState(game.state, 30, () => 0.25),
  });
}

/** A passive offer's base price (#144). */
const priceOf = (block: object) => (block as PassiveBlock).traits.priced!.basePrice;

describe("shop preview", () => {
  it("offers two passives and three unique cards, and buys into the right zones", () => {
    const game = shop();
    const stock = game.state.shopStock!;
    expect(stock.map(({ kind }) => kind)).toEqual(["passive", "passive", "card", "card", "card"]);
    expect(new Set(stock.map(({ block }) => block.id)).size).toBe(5);
    expect(game.state.coins).toBe(30);
    const passive = stock[0].block;
    const card = stock[2].block;
    expect(game.buyShopOffer(passive.id, "hand")).toBeNull();
    expect(game.buyShopOffer(passive.id, "passive-rack")?.block).toBe(passive);
    expect(game.buyShopOffer(card.id, "hand")?.block).toBe(card);
    // The passive cost its base price; the card the first-version 1 coin.
    expect(game.state.coins).toBe(30 - priceOf(passive) - 1);
    expect(game.state.passiveRack[0]).toBe(passive);
    expect(game.state.hand[0]).toBe(card);
    expect(game.state.shopStock).toHaveLength(3);
    expect(game.buyShopOffer(card.id, "hand")).toBeNull();
  });

  it("buys a third passive in a later shop without reusing an owned passive's id", () => {
    // Two passives bought in an earlier shop: the next shop must not offer the same ids.
    const first = shop();
    for (const offer of first.state.shopStock!.filter(({ kind }) => kind === "passive"))
      expect(first.buyShopOffer(offer.block.id, "passive-rack")).not.toBeNull();
    expect(first.state.passiveRack).toHaveLength(2);
    // Like leaving the shop: unbought (borrowed) cards go back to the deck before restocking.
    const unsold = first.state.shopStock!.flatMap((offer) =>
      offer.kind === "card" ? [offer.block as CardBlock] : [],
    );
    const restock = {
      ...first.state,
      deck: [...first.state.deck, ...unsold],
      shopStock: undefined,
    };
    const game = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, {
      ...first.snapshot(),
      state: shopPreviewState(restock, 5, () => 0.25),
    });
    const offer = game.state.shopStock!.find(({ kind }) => kind === "passive")!;
    expect(game.buyShopOffer(offer.block.id, "passive-rack")?.block).toBe(offer.block);
    const ids = game.state.passiveRack.map(({ id }) => id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    // The run must still save and load (duplicate passive ids make a save unloadable).
    const record = JSON.parse(JSON.stringify(toSaveRecord(game.snapshot())));
    expect(fromSaveRecord(record, standardDeck, dealerRegistry)?.state.passiveRack).toHaveLength(3);
  });

  it("restores the same stock and purchases after saving", () => {
    const game = shop();
    const card = game.state.shopStock!.find(({ kind }) => kind === "card")!;
    game.buyShopOffer(card.block.id, "hand");
    const record = JSON.parse(JSON.stringify(toSaveRecord(game.snapshot())));
    const restored = fromSaveRecord(record, standardDeck, dealerRegistry);
    expect(restored?.phase).toBe("shop");
    expect(restored?.state.coins).toBe(29);
    expect(restored?.state.shopStock?.map(({ block }) => block.id)).toEqual(
      game.state.shopStock?.map(({ block }) => block.id),
    );
    expect(restored?.state.hand[0].id).toBe(card.block.id);
  });
});

describe("passive prices (#144)", () => {
  it("charges a passive its base price, refusing it until the run can afford it", () => {
    const game = shop();
    const offer = game.state.shopStock!.find(({ kind }) => kind === "passive")!;
    const price = priceOf(offer.block);
    const poor = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, {
      ...game.snapshot(),
      state: { ...game.state, coins: price - 1 },
    });
    expect(poor.buyShopOffer(offer.block.id, "passive-rack")).toBeNull();
    const exact = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, {
      ...game.snapshot(),
      state: { ...game.state, coins: price },
    });
    expect(exact.buyShopOffer(offer.block.id, "passive-rack")).not.toBeNull();
    expect(exact.state.coins).toBe(0);
  });
});
