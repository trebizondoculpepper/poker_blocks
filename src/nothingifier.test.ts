import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun, type RunSnapshot } from "./game-run";
import { defaultShop } from "./game-modes";
import { asGenerated } from "./card-ownership";
import { getMaterialDefinition, withMaterial } from "./materials";
import { createNothingifier } from "./nothingifier";
import type { PassiveBlock } from "./passives";
import { resaleValue } from "./resale";
import { demoRunRules } from "./run-rules";
import { fromSaveRecord, toSaveRecord } from "./save";
import { shopPreviewState } from "./shop-stock";
import type { Cell } from "./traits/attachable";

const fresh = () => new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
const resume = (snapshot: RunSnapshot) =>
  GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, snapshot);
const withRack = (state: Partial<GameRun["state"]> = {}) => {
  const game = fresh();
  return resume({
    ...game.snapshot(),
    state: { ...game.state, passiveRack: [createNothingifier("n1")], ...state },
  });
};
const roundTrip = (run: GameRun) =>
  fromSaveRecord(
    JSON.parse(JSON.stringify(toSaveRecord(run.snapshot()))),
    standardDeck,
    dealerRegistry,
  );

describe("the Nothingifier item (#156)", () => {
  it("costs 4, has one use, and resells unused for 2", () => {
    const item = createNothingifier("n1");
    expect(item.traits.priced).toEqual({ basePrice: 4 });
    expect(item.traits.limitedUse).toEqual({ uses: 1, total: 1 });
    expect(resaleValue(item)).toBe(2);
  });

  it("removes a hand card for the run and is used up", () => {
    const run = withRack();
    const card = run.state.hand[0]!;
    expect(run.applyRackItem("n1", card.id)).not.toBeNull();
    expect(run.state.hand.map(({ id }) => id)).not.toContain(card.id);
    expect(run.state.removedCards).toEqual([card.id]);
    expect(run.state.passiveRack).toEqual([]);
  });

  it("removes a card on the table, leaving a gap; the rest of the field stays put", () => {
    const run = withRack();
    const [a, b] = run.state.hand as [CardBlock, CardBlock];
    const at = (x: number) => ({ x, y: 0, z: 0 }) as Cell;
    const placed = resume({
      ...run.snapshot(),
      state: {
        ...run.state,
        hand: run.state.hand.slice(2),
        field: [
          { block: a, cell: at(0) },
          { block: b, cell: at(1) },
        ],
      },
    });
    expect(placed.applyRackItem("n1", a.id)).not.toBeNull();
    expect(placed.state.field).toEqual([{ block: b, cell: at(1) }]);
    expect(placed.state.removedCards).toEqual([a.id]);
  });

  it("refuses a card not in the hand or on the table, spending nothing", () => {
    const run = withRack();
    const before = run.state;
    expect(run.applyRackItem("n1", run.state.deck[0]!.id)).toBeNull();
    expect(run.state).toBe(before);
    expect(run.state.passiveRack).toHaveLength(1);
  });

  it("keeps a removed card out of the run through save and Continue, with its saved state", () => {
    const run = withRack();
    const card = run.state.hand[0]!;
    run.changeCardMaterial(card.id, "steel");
    run.applyRackItem("n1", card.id);
    const restored = roundTrip(run)!;
    expect(restored).not.toBeNull();
    const everywhere = [
      ...restored.state.hand,
      ...restored.state.deck,
      ...restored.state.discardPile,
      ...restored.state.field.map(({ block }) => block),
    ].map(({ id }) => id);
    expect(everywhere).not.toContain(card.id);
    expect(restored.state.removedCards).toEqual([card.id]);
    expect(restored.state.cardStates?.[card.id]).toBeUndefined();
  });

  it("removes a card made on the table (a cloud) without recording it", () => {
    const cloud = asGenerated(
      withMaterial({ ...standardDeck[0]!, id: "made.1" }, getMaterialDefinition("cloud")),
    );
    const run = withRack({
      field: [{ block: cloud, cell: { x: 0, y: 0, z: 0 } as Cell }],
      generatedCards: [cloud],
    });
    expect(run.applyRackItem("n1", cloud.id)).not.toBeNull();
    expect(run.state.field).toEqual([]);
    expect(run.state.generatedCards).toBeUndefined();
    expect(run.state.removedCards).toBeUndefined();
  });
});

describe("the Nothingifier in the shop (#156)", () => {
  const items = (round: number, seed: number) =>
    (
      shopPreviewState(fresh().state, 99, mulberry(seed), defaultShop, round).shopStock ?? []
    ).filter(({ kind }) => kind === "nothingifier" || kind === "transmogrifier");

  it("shares the item slots with transmogrifiers, from round 1, at most once a shop", () => {
    for (const round of [1, 5, 9]) {
      const seen = Array.from({ length: 60 }, (_, seed) => items(round, seed + 1));
      for (const offers of seen) expect(offers).toHaveLength(defaultShop.itemSlots ?? 1);
      expect(seen.flat().some(({ kind }) => kind === "nothingifier")).toBe(true);
      expect(seen.flat().some(({ kind }) => kind === "transmogrifier")).toBe(true);
    }
    const two = { ...defaultShop, itemSlots: 2 };
    for (let seed = 1; seed <= 60; seed++) {
      const stock = shopPreviewState(fresh().state, 99, mulberry(seed), two, 3).shopStock ?? [];
      expect(stock.filter(({ kind }) => kind === "nothingifier").length).toBeLessThanOrEqual(1);
    }
  });

  it("buys into the Items rack for 4 and survives a saved shop", () => {
    const item = createNothingifier("shop.item.1");
    const game = fresh();
    const shop = resume({
      ...game.snapshot(),
      phase: "shop",
      state: { ...game.state, coins: 10, shopStock: [{ kind: "nothingifier", block: item }] },
    });
    const saved = roundTrip(shop)!;
    expect((saved.state.shopStock![0]!.block as PassiveBlock).traits).toMatchObject({
      priced: { basePrice: 4 },
      nothingifier: {},
    });
    expect(shop.buyShopOffer(item.id, "passive-rack")).not.toBeNull();
    expect(shop.state.coins).toBe(6);
    const rack = roundTrip(shop)!.state.passiveRack[0]!;
    expect(rack.traits).toMatchObject({ nothingifier: {}, limitedUse: { uses: 1, total: 1 } });
  });

  it("is never granted or offered as a bare passive", async () => {
    const { randomPassiveDefinitions } = await import("./passives");
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999])
      for (const definition of randomPassiveDefinitions(3, () => roll))
        expect(definition.id).not.toBe("nothingifier");
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
