import { describe, expect, it } from "vite-plus/test";
import type { PassiveBlock } from "./passives";
import type { CardBlock } from "./cards";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { fromSaveRecord, toSaveRecord } from "./save";
import { demoRunRules } from "./run-rules";
import { shopPreviewState } from "./shop-stock";
import { offerKind } from "./offer-kinds";
import { getMaterialDefinition, materialOf, type BlockMaterial } from "./materials";
import { cardOfferPrice } from "./balance";

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
    const card = stock[2].block as CardBlock;
    const cardPrice = offerKind(stock[2]).price(card, game.offerRun);
    expect(game.buyShopOffer(passive.id, "hand")).toBeNull();
    expect(game.buyShopOffer(passive.id, "passive-rack")?.block).toBe(passive);
    expect(game.buyShopOffer(card.id, "hand")?.block).toBe(card);
    // The passive cost its base price; the card its material's price plus its rank's (#143).
    expect(game.state.coins).toBe(30 - priceOf(passive) - cardPrice);
    expect(game.state.passiveRack[0]).toBe(passive);
    // A bought card joins the deck, and the run's ledger of bought cards (#143).
    expect(game.state.deck.at(-1)).toBe(card);
    expect(game.state.boughtCards).toEqual([card]);
    expect(game.state.shopStock).toHaveLength(3);
    expect(game.buyShopOffer(card.id, "hand")).toBeNull();
  });

  it("buys a third passive in a later shop without reusing an owned passive's id", () => {
    // Two passives bought in an earlier shop: the next shop must not offer the same ids.
    const first = shop();
    for (const offer of first.state.shopStock!.filter(({ kind }) => kind === "passive"))
      expect(first.buyShopOffer(offer.block.id, "passive-rack")).not.toBeNull();
    expect(first.state.passiveRack).toHaveLength(2);
    // Like leaving the shop: unbought cards simply go before restocking.
    const restock = { ...first.state, shopStock: undefined };
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
    expect(restored?.state.coins).toBe(game.state.coins);
    expect(restored?.state.shopStock?.map(({ block }) => block.id)).toEqual(
      game.state.shopStock?.map(({ block }) => block.id),
    );
    // The bought card is rebuilt in full: same id, identity and material (#143).
    const back = restored?.state.deck.at(-1);
    expect(back?.id).toBe(card.block.id);
    expect(back && materialOf(back)).toBe(materialOf(card.block as CardBlock));
    expect(back?.traits.identity).toEqual((card.block as CardBlock).traits.identity);
    expect(restored?.state.boughtCards?.map(({ id }) => id)).toEqual([card.block.id]);
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

describe("card offers (#143)", () => {
  it("are new cards of a priced material, not cards borrowed from the deck", () => {
    const game = shop();
    const cards = game.state.shopStock!.filter(({ kind }) => kind === "card");
    expect(cards).toHaveLength(3);
    const deckIds = new Set(game.state.deck.map(({ id }) => id));
    for (const { block } of cards) {
      expect(deckIds.has(block.id)).toBe(false);
      expect(getMaterialDefinition(materialOf(block as CardBlock)).shop).toBeDefined();
    }
    // The whole deck stays: nothing was borrowed out of it.
    expect(game.state.deck).toHaveLength(52);
  });

  it("price a card at its material's base price plus its rank's surcharge", () => {
    const wood = { shop: { basePrice: 3 } };
    expect(cardOfferPrice("7", wood)).toBe(3);
    expect(cardOfferPrice("10", wood)).toBe(3);
    expect(cardOfferPrice("J", wood)).toBe(4);
    expect(cardOfferPrice("K", wood)).toBe(4);
    expect(cardOfferPrice("A", wood)).toBe(5);
  });

  it("records the agreed material prices", () => {
    const price = (id: string) => getMaterialDefinition(id as BlockMaterial).shop?.basePrice;
    expect(
      ["paper", "wood", "steel", "meat", "ice", "fire", "gold", "prismatic"].map(price),
    ).toEqual([1, 3, 4, 6, 2, 4, 8, 12]);
  });
});
