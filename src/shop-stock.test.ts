import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameSession } from "./game-session";
import { fromSaveRecord, toSaveRecord } from "./save";
import { demoSessionConfig } from "./session-config";
import { shopPreviewState } from "./shop-stock";

function shop() {
  const game = new GameSession(dealerRegistry, demoSessionConfig, standardDeck, () => 0.25);
  return GameSession.fromSnapshot(dealerRegistry, demoSessionConfig, standardDeck, {
    ...game.snapshot(),
    phase: "shop",
    state: shopPreviewState(game.state, 5, () => 0.25),
  });
}

describe("shop preview", () => {
  it("offers two passives and three unique cards, and buys into the right zones", () => {
    const game = shop();
    const stock = game.state.shopStock!;
    expect(stock.map(({ kind }) => kind)).toEqual(["passive", "passive", "card", "card", "card"]);
    expect(new Set(stock.map(({ block }) => block.id)).size).toBe(5);
    expect(game.state.coins).toBe(5);
    const passive = stock[0].block;
    const card = stock[2].block;
    expect(game.buyShopOffer(passive.id, "hand")).toBeNull();
    expect(game.buyShopOffer(passive.id, "passive-rack")?.block).toBe(passive);
    expect(game.buyShopOffer(card.id, "hand")?.block).toBe(card);
    expect(game.state.coins).toBe(3);
    expect(game.state.passiveRack[0]).toBe(passive);
    expect(game.state.hand[0]).toBe(card);
    expect(game.state.shopStock).toHaveLength(3);
    expect(game.buyShopOffer(card.id, "hand")).toBeNull();
  });

  it("restores the same stock and purchases after saving", () => {
    const game = shop();
    const card = game.state.shopStock!.find(({ kind }) => kind === "card")!;
    game.buyShopOffer(card.block.id, "hand");
    const record = JSON.parse(JSON.stringify(toSaveRecord(game.snapshot())));
    const restored = fromSaveRecord(record, standardDeck, dealerRegistry);
    expect(restored?.phase).toBe("shop");
    expect(restored?.state.coins).toBe(4);
    expect(restored?.state.shopStock?.map(({ block }) => block.id)).toEqual(
      game.state.shopStock?.map(({ block }) => block.id),
    );
    expect(restored?.state.hand[0].id).toBe(card.block.id);
  });
});
