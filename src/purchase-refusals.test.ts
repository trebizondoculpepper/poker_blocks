import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { createNothingifier } from "./nothingifier";
import { refusalSound } from "./purchase-refusals";
import { demoRunRules } from "./run-rules";
import type { ShopOffer } from "./offer-kinds";
import { createTransmogrifier } from "./transmogrifiers";

/** A run in the shop with a rack of `capacity` slots. */
function shop(
  coins: number,
  rack: GameRun["state"]["passiveRack"],
  stock: ShopOffer[],
  capacity = 3,
) {
  const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
  const run = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, {
    ...game.snapshot(),
    phase: "shop",
    state: { ...game.state, coins, passiveRack: rack, shopStock: stock },
  });
  Object.defineProperty(run, "rackCapacity", { get: () => capacity });
  return run;
}
const item = (id: string) => createNothingifier(id, 4);
const full = () =>
  Array.from({ length: 3 }, (_, i) => createTransmogrifier("wood", `held.${i}`, 6));

describe("purchase refusal reasons (#481)", () => {
  const offer = { kind: "nothingifier", block: item("shop.item.1") } as ShopOffer;

  it("says a full rack is full, not that the player is short of coins", () => {
    const run = shop(99, full(), [offer]);
    expect(run.purchaseVerdict(offer.block.id, "passive-rack")).toEqual({ reason: "rack-full" });
  });

  it("says unaffordable first when both apply (the documented precedence)", () => {
    const run = shop(0, full(), [offer]);
    expect(run.purchaseVerdict(offer.block.id, "passive-rack")).toEqual({ reason: "unaffordable" });
  });

  it("gives other reasons their own names, never conflating them with a full rack", () => {
    const run = shop(99, [], [offer]);
    expect(run.purchaseVerdict(offer.block.id, "hand")).toEqual({ reason: "wrong-destination" });
    expect(run.purchaseVerdict("nothing-here", "passive-rack")).toEqual({
      reason: "unknown-offer",
    });
    expect(run.purchaseVerdict(offer.block.id, "passive-rack")).toBeNull();
  });

  it("is side-effect free, and buying follows the same verdict", () => {
    const run = shop(99, full(), [offer]);
    const before = run.state;
    run.purchaseVerdict(offer.block.id, "passive-rack");
    expect(run.state).toBe(before);
    expect(run.buyShopOffer(offer.block.id, "passive-rack")).toBeNull();
    expect(run.state.coins).toBe(99);
    expect(run.state.passiveRack).toHaveLength(run.rackCapacity);
  });

  it("an unlimited rack never reports rack-full", () => {
    const run = shop(99, full(), [offer], Number.POSITIVE_INFINITY);
    expect(run.purchaseVerdict(offer.block.id, "passive-rack")).toBeNull();
  });
});

describe("refusal sounds (#481)", () => {
  it("each reason sounds its own way, and any other refusal is the usual no", () => {
    expect(refusalSound("unaffordable")).toBe("shop.buy.denied");
    expect(refusalSound("rack-full")).toBe("shop.rack_full");
    expect(refusalSound("rack-full")).not.toBe(refusalSound("unaffordable"));
    expect(refusalSound("wrong-destination")).toBe("action.denied");
  });
});
