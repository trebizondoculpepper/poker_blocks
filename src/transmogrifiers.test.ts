import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { getMaterialDefinition } from "./materials";
import { passiveDefinitions, type PassiveBlock } from "./passives";
import { demoRunRules } from "./run-rules";
import { fromSaveRecord, toSaveRecord } from "./save";
import { shopPreviewState } from "./shop-stock";
import { defaultShop } from "./game-modes";
import {
  createTransmogrifier,
  defaultTransmogrifierUses,
  transmogrifierId,
  transmogrifierMaterials,
} from "./transmogrifiers";

const priceOf = (id: string) =>
  transmogrifierMaterials().find(({ material }) => material.id === id)?.price;

describe("transmogrifier items (#388)", () => {
  it("exists for every gameplay material with a price: twice its base price, paper at 2", () => {
    expect(priceOf("wood")).toBe(6);
    expect(priceOf("steel")).toBe(8);
    expect(priceOf("ice")).toBe(4);
    expect(priceOf("fire")).toBe(8);
    expect(priceOf("meat")).toBe(12);
    expect(priceOf("gold")).toBe(16);
    expect(priceOf("prismatic")).toBe(24);
    expect(priceOf("custard")).toBe(6);
    expect(priceOf("paper")).toBe(2);
    for (const { material } of transmogrifierMaterials())
      expect(passiveDefinitions.has(transmogrifierId(material.id as never))).toBe(true);
  });

  it("is never drawn into the ordinary passive offers, only its dedicated slots", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const random = mulberry(seed);
      const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, random);
      const stock = shopPreviewState(game.state, 99, random, defaultShop, 5).shopStock ?? [];
      const transmogrifiers = stock.filter(({ kind }) => kind === "transmogrifier");
      expect(transmogrifiers).toHaveLength(defaultShop.transmogrifierSlots ?? 1);
      expect(
        stock
          .filter(({ kind }) => kind === "passive")
          .map(({ block }) => (block as PassiveBlock).definitionId)
          .filter((id) => id.startsWith("transmogrifier.")),
      ).toEqual([]);
      expect(stock.length).toBeLessThanOrEqual(9);
    }
  });

  it("offers only materials unlocked this round", () => {
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.5);
    const unlocked = (round: number) =>
      new Set(
        Array.from({ length: 30 }, (_, seed) => {
          const stock = shopPreviewState(game.state, 99, mulberry(seed + 1), defaultShop, round);
          return stock
            .shopStock!.filter(({ kind }) => kind === "transmogrifier")
            .map(({ block }) => (block as PassiveBlock).traits.transmogrifier?.material);
        }).flat(),
      );
    expect([...unlocked(1)].toSorted((a, b) => String(a).localeCompare(String(b)))).toEqual([
      "paper",
      "wood",
    ]);
    expect(unlocked(2).has("gold")).toBe(false);
  });

  it("buys into the Items rack with all its uses and keeps its price and uses through a save", () => {
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
    const item = createTransmogrifier("steel", "shop.transmogrifier.1", 8);
    const shop = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, {
      ...game.snapshot(),
      phase: "shop",
      state: { ...game.state, coins: 20, shopStock: [{ kind: "transmogrifier", block: item }] },
    });
    expect(shop.buyShopOffer(item.id, "passive-rack")?.block).toBe(item);
    expect(shop.state.coins).toBe(12);
    const bought = shop.state.passiveRack.find(({ id }) => id === item.id)!;
    expect(bought.traits.limitedUse).toEqual({
      uses: defaultTransmogrifierUses,
      total: defaultTransmogrifierUses,
    });

    // One use spent (as #389 will), then saved and restored.
    const worn = { ...bought, traits: { ...bought.traits, limitedUse: { uses: 1, total: 2 } } };
    const snapshot = shop.snapshot();
    const record = JSON.parse(
      JSON.stringify(
        toSaveRecord({
          ...snapshot,
          state: { ...snapshot.state, passiveRack: [worn] },
        }),
      ),
    );
    const restored = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    const back = restored.state.passiveRack[0]!;
    expect(back.traits.limitedUse).toEqual({ uses: 1, total: 2 });
    expect(back.traits.priced).toEqual({ basePrice: 8 });
    expect(back.traits.transmogrifier).toEqual({ material: "steel" });

    const exhausted = structuredClone(record);
    exhausted.state.passiveRack[0].traits.limitedUse.uses = 0;
    expect(fromSaveRecord(exhausted, standardDeck, dealerRegistry)).toBeNull();
  });

  it("rebuilds a saved transmogrifier offer exactly", () => {
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
    const item = createTransmogrifier("gold", "shop.transmogrifier.1", 16);
    const record = JSON.parse(
      JSON.stringify(
        toSaveRecord({
          ...game.snapshot(),
          phase: "shop",
          state: { ...game.state, shopStock: [{ kind: "transmogrifier", block: item }] },
        }),
      ),
    );
    const offer = fromSaveRecord(record, standardDeck, dealerRegistry)!.state.shopStock![0]!;
    expect(offer.kind).toBe("transmogrifier");
    expect((offer.block as PassiveBlock).traits).toMatchObject({
      priced: { basePrice: 16 },
      transmogrifier: { material: "gold" },
    });
    expect(getMaterialDefinition("gold").shop?.basePrice).toBe(8);
  });
});

function mulberry(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let next = Math.imul(value ^ (value >>> 15), 1 | value);
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

describe("transmogrifier shop presentation (#388 review)", () => {
  it("has a registered shop view, so a shop holding one can be drawn", async () => {
    const { hasOfferView } = await import("./shop-view");
    expect(hasOfferView("transmogrifier")).toBe(true);
  });

  it("refuses stock whose guarantees and dedicated slots overflow nine offers", async () => {
    const { validateShopStock } = await import("./shop-stock-config");
    expect(
      validateShopStock({
        minOffers: 9,
        maxOffers: 9,
        guaranteedCards: 9,
        guaranteedPassives: 0,
        transmogrifierSlots: 1,
      }).map(({ field }) => field),
    ).toContain("transmogrifierSlots");
  });
});

describe("transmogrifiers are never granted as bare passives (#395 review)", () => {
  it("random passive grants skip items stocked only by their dedicated slots", async () => {
    const { randomPassiveDefinitions } = await import("./passives");
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999])
      for (const definition of randomPassiveDefinitions(3, () => roll))
        expect(definition.id.startsWith("transmogrifier.")).toBe(false);
describe("transmogrifier resale (#390)", () => {
  it("pays half its price times the share of uses left, at least 1 coin", async () => {
    const { resaleValue } = await import("./resale");
    expect(resaleValue(createTransmogrifier("steel", "t", 8))).toBe(4);
    expect(resaleValue(createTransmogrifier("steel", "t", 8, 1, 2))).toBe(2);
    expect(resaleValue(createTransmogrifier("paper", "t", 2, 1, 2))).toBe(1);
    expect(resaleValue(createTransmogrifier("prismatic", "t", 24, 1, 2))).toBe(6);
  });

  it("leaves ordinary passives at half their price", async () => {
    const { defaultResale } = await import("./resale");
    expect(defaultResale(7)).toBe(3);
    expect(defaultResale(1)).toBe(1);
  });
});
