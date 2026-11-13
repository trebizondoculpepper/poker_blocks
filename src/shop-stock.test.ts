import { describe, expect, it } from "vite-plus/test";
import type { PassiveBlock } from "./passives";
import { ordinaryPassives } from "./passives";
import type { CardBlock } from "./cards";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { fromSaveRecord, toSaveRecord } from "./save";
import { demoRunRules } from "./run-rules";
import { passiveWeight, shopPreviewState } from "./shop-stock";
import { materialUnlockRound, materialsNamedBy, passiveUnlockRound } from "./offer-eligibility";
import type { PassiveDefinition } from "./passives";
import { defaultShop } from "./game-modes";
import { passiveFrequencies, validateWeightCurve, weightAt } from "./offer-weights";
import { createPassiveBlock, passiveDefinitions } from "./passives";
import { blockMaterials, materialDefinitions } from "./materials";
import { validateMaterialBalance, validatePassiveBalance } from "./balance";
import { offerKind } from "./offer-kinds";
import { getMaterialDefinition, materialOf, withMaterial, type BlockMaterial } from "./materials";
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
  it("rejects stock counts that would overflow the shop or its guaranteed slots", () => {
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
    expect(() =>
      shopPreviewState(game.state, 5, () => 0.25, {
        minOffers: 2,
        maxOffers: 2,
        guaranteedPassives: 5,
        guaranteedCards: 1,
      }),
    ).toThrow("Invalid shop stock");
    expect(() =>
      shopPreviewState(game.state, 5, () => 0.25, { minOffers: 5, maxOffers: 10 }),
    ).toThrow("Invalid shop stock");
  });
  it("uses the configured guaranteed offer counts", () => {
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
    const state = shopPreviewState(game.state, 5, () => 0.25, {
      minOffers: 4,
      maxOffers: 4,
      guaranteedPassives: 2,
      guaranteedCards: 2,
      itemSlots: 0,
    });
    expect(state.shopStock?.map(({ kind }) => kind)).toEqual([
      "passive",
      "passive",
      "card",
      "card",
    ]);
  });
  it("offers 5–9 unique offers, passives first, and buys into the right zones (#145)", () => {
    const game = shop();
    const stock = game.state.shopStock!;
    expect(stock.length).toBeGreaterThanOrEqual(5);
    expect(stock.length).toBeLessThanOrEqual(9);
    const kinds = stock.map(({ kind }) => kind);
    expect(kinds).toContain("passive");
    expect(kinds).toContain("card");
    expect(kinds.lastIndexOf("passive")).toBeLessThan(kinds.indexOf("card"));
    expect(new Set(stock.map(({ block }) => block.id)).size).toBe(stock.length);
    expect(game.state.coins).toBe(30);
    const passive = stock[0].block;
    const cardOffer = stock.find(({ kind }) => kind === "card")!;
    const card = cardOffer.block as CardBlock;
    const cardPrice = offerKind(cardOffer).price(card, game.offerRun);
    expect(game.buyShopOffer(passive.id, "hand")).toBeNull();
    expect(game.buyShopOffer(passive.id, "passive-rack")?.block).toBe(passive);
    expect(game.buyShopOffer(card.id, "hand")?.block).toBe(card);
    // The passive cost its base price; the card its material's price plus its rank's (#143).
    expect(game.state.coins).toBe(30 - priceOf(passive) - cardPrice);
    expect(game.state.passiveRack[0]).toBe(passive);
    // A bought card joins the deck, and the run's ledger of bought cards (#143).
    expect(game.state.deck.at(-1)).toBe(card);
    expect(game.state.boughtCards).toEqual([card]);
    expect(game.state.shopStock).toHaveLength(stock.length - 2);
    expect(game.buyShopOffer(card.id, "hand")).toBeNull();
  });

  it("buys a third passive in a later shop without reusing an owned passive's id", () => {
    // Two passives bought in an earlier shop: the next shop must not offer the same ids.
    const first = shop();
    for (const offer of first.state.shopStock!.filter(({ kind }) => kind === "passive"))
      expect(first.buyShopOffer(offer.block.id, "passive-rack")).not.toBeNull();
    const owned = first.state.passiveRack.length;
    expect(owned).toBeGreaterThan(0);
    // Like leaving the shop: unbought cards simply go before restocking.
    const restock = { ...first.state, shopStock: undefined };
    const game = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, {
      ...first.snapshot(),
      state: shopPreviewState(restock, 5, () => 0.25),
    });
    const offer = game.state.shopStock!.find(({ kind }) => kind === "passive")!;
    expect(game.buyShopOffer(offer.block.id, "passive-rack")?.block).toBe(offer.block);
    const ids = game.state.passiveRack.map(({ id }) => id);
    expect(ids).toHaveLength(owned + 1);
    expect(new Set(ids).size).toBe(owned + 1);
    // The run must still save and load (duplicate passive ids make a save unloadable).
    const record = JSON.parse(JSON.stringify(toSaveRecord(game.snapshot())));
    expect(fromSaveRecord(record, standardDeck, dealerRegistry)?.state.passiveRack).toHaveLength(
      owned + 1,
    );
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
    expect(cards.length).toBeGreaterThan(0);
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
    // Paper is never sold: every run starts with it.
    expect(
      ["paper", "wood", "steel", "earth", "meat", "ice", "fire", "custard", "gold"].map(price),
    ).toEqual([undefined, 3, 4, 3, 6, 2, 4, 3, 8]);
    // Terracotta is only baked from earth (#371): it keeps its price, at zero weight, so saved
    // offers stay priced.
    expect(price("terracotta")).toBe(3);
    expect(
      [1, 3, 6, 10].map((round) =>
        weightAt(getMaterialDefinition("terracotta").shop!.weights, round),
      ),
    ).toEqual([0, 0, 0, 0]);
    expect(price("prismatic")).toBe(12);
  });
});

describe("saves from before #143", () => {
  it("return a borrowed card offer to the deck instead of failing to load", () => {
    const game = shop();
    const record = JSON.parse(JSON.stringify(toSaveRecord(game.snapshot())));
    // The old format: the shop borrowed the deck's last card and saved only its id.
    const lent = record.state.deck.pop();
    record.state.shopStock = [
      ...record.state.shopStock.filter((offer: { kind: string }) => offer.kind !== "card"),
      { kind: "card", cardId: lent },
    ];
    const restored = fromSaveRecord(record, standardDeck, dealerRegistry);
    expect(restored).not.toBeNull();
    expect(restored?.state.deck.map(({ id }) => id)).toContain(lent);
    expect(restored?.state.shopStock?.some(({ kind }) => kind === "card")).toBe(false);
  });
});

describe("stock by round and weight (#145)", () => {
  const random = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const stockAt = (round: number, seed: number, rack: GameRun["state"]["passiveRack"] = []) => {
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
    return shopPreviewState(
      { ...game.state, passiveRack: rack },
      0,
      random(seed),
      defaultShop,
      round,
    ).shopStock!;
  };
  const materials = (offers: readonly { kind: string; block: object }[]) =>
    offers.flatMap(({ kind, block }) => (kind === "card" ? [materialOf(block as CardBlock)] : []));

  it("always holds 5–9 offers with at least one passive and one card", () => {
    for (let round = 1; round <= 10; round++)
      for (let seed = 1; seed <= 25; seed++) {
        const offers = stockAt(round, seed);
        expect(offers.length).toBeGreaterThanOrEqual(5);
        expect(offers.length).toBeLessThanOrEqual(9);
        expect(offers.some(({ kind }) => kind === "passive")).toBe(true);
        expect(offers.some(({ kind }) => kind === "card")).toBe(true);
      }
  });

  it("offers only unlocked materials, and never paper", () => {
    const seen = (round: number) =>
      new Set(Array.from({ length: 60 }, (_, seed) => materials(stockAt(round, seed + 1))).flat());
    expect([...seen(1)]).toEqual(["wood"]);
    expect(seen(2).has("steel")).toBe(true);
    expect(seen(2).has("earth")).toBe(true);
    expect(seen(1).has("earth")).toBe(false);
    for (const round of [2, 5, 9]) expect(seen(round).has("terracotta")).toBe(false);
    expect(seen(3).has("custard")).toBe(true);
    expect(seen(2).has("custard")).toBe(false);
    expect(seen(5).has("gold")).toBe(false);
    expect(seen(6).has("prismatic")).toBe(false);
    expect(seen(7).has("prismatic")).toBe(true);
    for (const round of [1, 4, 8]) expect(seen(round).has("paper")).toBe(false);
    expect(seen(8).has("wood")).toBe(true);
  });

  it("makes each round's newly unlocked materials the most common, in the agreed order", () => {
    const weightIn = (id: string, round: number) =>
      weightAt(getMaterialDefinition(id as BlockMaterial).shop?.weights ?? [[1, 0]], round);
    const leaders = (round: number) => {
      const top = Math.max(...blockMaterials.map((id) => weightIn(id, round)));
      return blockMaterials.filter((id) => weightIn(id, round) === top).sort();
    };
    expect([1, 2, 3, 4, 5, 6, 7].map(leaders)).toEqual([
      ["wood"],
      ["earth", "steel"],
      ["custard"],
      ["fire", "ice", "meat"],
      // Nothing unlocks in round 5 since custard moved to round 3 (#381): round 4's curves lead.
      ["fire", "ice", "meat"],
      ["gold"],
      ["prismatic"],
    ]);
  });

  it("follows the agreed weight curves", () => {
    const curve = (id: string) => getMaterialDefinition(id as BlockMaterial).shop!.weights;
    // Each material leads its own round at 4, falls to 1.5 the next, then stays at 1.
    expect([1, 2, 3, 12].map((round) => weightAt(curve("wood"), round))).toEqual([4, 1.5, 1, 1]);
    expect([1, 2, 3, 4].map((round) => weightAt(curve("steel"), round))).toEqual([0, 4, 1.5, 1]);
    expect([3, 4, 5].map((round) => weightAt(curve("fire"), round))).toEqual([0, 4, 1.5]);
    expect([6, 7, 8, 9].map((round) => weightAt(curve("prismatic"), round))).toEqual([
      0, 4, 1.5, 1,
    ]);
    const passive = (name: string) => passiveFrequencies.get(name);
    expect([1, 3, 5, 7].map((r) => weightAt(passive("additiveScoring"), r))).toEqual([4, 1, 2, 2]);
    expect([1, 3, 5, 7].map((r) => weightAt(passive("multiplicativeScoring"), r))).toEqual([
      1, 4, 4, 4,
    ]);
    expect([1, 3, 5, 7].map((r) => weightAt(passive("exponentialScoring"), r))).toEqual([
      0, 1, 2, 4,
    ]);
  });

  it("never offers a passive before its unlock round, or one the run owns", () => {
    for (let seed = 1; seed <= 40; seed++)
      for (const { kind, block } of stockAt(1, seed))
        if (kind === "passive")
          expect((block as PassiveBlock).traits.priced!.basePrice).toBeDefined();
    const early = passiveDefinitions.names().map((name) => passiveDefinitions.get(name));
    for (const definition of early.filter(({ shop }) => shop && shop.unlockRound > 1))
      expect(passiveWeight(definition, 1)).toBe(0);
    const rack = [createPassiveBlock("double-line", "owned.1")];
    for (let seed = 1; seed <= 40; seed++)
      expect(
        stockAt(1, seed, rack).some(
          ({ block }) => (block as PassiveBlock).definitionId === "double-line",
        ),
      ).toBe(false);
  });

  it("has valid curves, and something of each kind to offer from round 1", () => {
    expect(validateMaterialBalance(materialDefinitions)).toEqual([]);
    expect(
      // Normal-shop balance covers what the ordinary catalogue can stock.
      validatePassiveBalance(ordinaryPassives()),
    ).toEqual([]);
    expect(
      validateWeightCurve("bad", [
        [2, 1],
        [2, -1],
      ]),
    ).toHaveLength(2);
  });
});

describe("material-bound passives (#165)", () => {
  const definition = (id: string) => passiveDefinitions.get(id);

  it("never unlock before a material their rules name", () => {
    expect(materialsNamedBy(definition("woodworker")).map(({ id }) => id)).toEqual(["wood"]);
    for (const name of passiveDefinitions.names()) {
      const passive = definition(name);
      for (const material of materialsNamedBy(passive))
        expect(passiveUnlockRound(passive)).toBeGreaterThanOrEqual(materialUnlockRound(material));
    }
    // A passive naming meat (round 4) can't come earlier even if its data says round 1.
    const early = {
      ...definition("woodworker"),
      shop: { ...definition("woodworker").shop!, unlockRound: 1 },
      eventRules: [{ when: { id: "material-is", config: { material: "meat" } } }],
    } as unknown as PassiveDefinition;
    expect(passiveUnlockRound(early)).toBe(4);
    expect(passiveWeight(early, 2)).toBe(0);
    expect(validatePassiveBalance([early])).toContain(
      "woodworker: unlocks before meat, which it names",
    );
  });

  it("refuse a purchase before the passive is available, even from a stale offer", () => {
    const game = shop();
    const block = createPassiveBlock("carnivore", "stale.1");
    const stale = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, {
      ...game.snapshot(),
      state: { ...game.state, shopStock: [{ kind: "passive", block }] },
    });
    expect(stale.round).toBeLessThan(passiveUnlockRound(definition("carnivore")));
    expect(stale.buyShopOffer(block.id, "passive-rack")).toBeNull();
  });
});

describe("a saved terracotta card offer after #371 (#429 review)", () => {
  it("loads priced and buyable", () => {
    const game = shop();
    const card = withMaterial(standardDeck[0]!, getMaterialDefinition("terracotta"));
    const record = JSON.parse(
      JSON.stringify(
        toSaveRecord({
          ...game.snapshot(),
          state: { ...game.state, coins: 20, shopStock: [{ kind: "card", block: card }] },
        }),
      ),
    );
    const restored = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    const offer = restored.state.shopStock![0]!;
    expect(cardOfferPrice("2", getMaterialDefinition("terracotta"))).toBe(3);
    const resumed = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, restored);
    expect(resumed.buyShopOffer(offer.block.id, "hand")).not.toBeNull();
  });
});
