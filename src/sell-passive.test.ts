import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { createPassiveBlock } from "./passives";
import { fromSaveRecord, toSaveRecord } from "./save";
import { demoRunRules } from "./run-rules";

function withRack(config = demoRunRules) {
  const game = new GameRun(dealerRegistry, config, standardDeck, () => 0);
  game.installPassive(createPassiveBlock("scrapper", "passive.1"));
  game.installPassive(createPassiveBlock("double-line", "passive.2"));
  return game;
}

describe("selling a passive (issue #16)", () => {
  it("removes exactly that passive and adds its sell value; no discard, play or discard used", () => {
    const game = withRack();
    const before = game.state;
    expect(game.sellPassive("passive.1")).toBe(1);
    expect(game.state.passiveRack.map(({ id }) => id)).toEqual(["passive.2"]);
    expect(game.state.coins).toBe(before.coins + 1);
    expect(game.state.discardPile).toBe(before.discardPile);
    expect(game.state.round).toEqual(before.round);
    expect(game.state.hand).toBe(before.hand);
  });

  it("refuses an unknown passive, a second sale of the same one, and after the run is over", () => {
    const game = withRack();
    expect(game.sellPassive("passive.9")).toBeNull();
    game.sellPassive("passive.1");
    expect(game.sellPassive("passive.1")).toBeNull();
    expect(game.state.passiveRack).toHaveLength(1);
    game.forceOutcome("lost");
    game.advance();
    const coins = game.state.coins;
    expect(game.sellPassive("passive.2")).toBeNull();
    expect(game.state.coins).toBe(coins);
  });

  it("takes its price from the run's policy", () => {
    const game = withRack({ ...demoRunRules, passivePrices: { buy: 5, sell: 2 } });
    expect(game.passivePrices).toEqual({ buy: 5, sell: 2 });
    expect(game.sellPassive("passive.2")).toBe(2);
  });

  it("stops a sold passive from reacting to events", () => {
    // Control: while installed, Scrapper pays a coin for a discard.
    const kept = withRack();
    const start = kept.state.coins;
    kept.discard(kept.state.hand[0].id);
    expect(kept.state.coins).toBe(start + 1);
    const game = withRack();
    game.sellPassive("passive.1"); // Scrapper: a coin per block discarded
    const coins = game.state.coins;
    game.discard(game.state.hand[0].id);
    expect(game.state.coins).toBe(coins);
  });

  it("is kept by a save and reload, without losing or duplicating blocks", () => {
    const game = withRack();
    game.sellPassive("passive.1");
    const record = JSON.parse(JSON.stringify(toSaveRecord(game.snapshot())));
    const snapshot = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    expect(snapshot.state.passiveRack.map(({ id }) => id)).toEqual(["passive.2"]);
    expect(snapshot.state.coins).toBe(game.state.coins);
  });

  it("refuses a bad price policy without changing anything", () => {
    for (const sell of [-1, 0.5, Number.NaN]) {
      const game = withRack({ ...demoRunRules, passivePrices: { buy: 1, sell } });
      const before = game.state;
      expect(game.sellPassive("passive.1")).toBeNull();
      expect(game.state).toBe(before);
    }
  });

  it("waits for a won stage's rewards to be paid before selling", () => {
    const game = withRack();
    game.forceOutcome("won");
    expect(game.stageRewardsPending).toBe(true);
    expect(game.sellPassive("passive.1")).toBeNull();
    game.claimStageRewards();
    expect(game.stageRewardsPending).toBe(false);
    expect(game.sellPassive("passive.1")).toBe(1);
  });
});
