import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { gameModeFor } from "./game-modes";
import { GameRun } from "./game-run";
import { baseRunRules, modeTraitRules } from "./mode-trait-rules";
import { demoRunRules, type RunRules } from "./run-rules";

const traits = gameModeFor("game").traits;
const run = (rules: RunRules) => new GameRun(dealerRegistry, rules, standardDeck, () => 0);
const toShop = (game: GameRun) => {
  game.forceOutcome("won");
  game.advance();
  return game;
};

describe("mode traits shape the run's rules (#36)", () => {
  it("gives a mode's runs its rack capacity and shop stocking from its traits", () => {
    const rules = baseRunRules({ traits });
    expect(rules.rackCapacity).toBe(traits.passiveRack!.capacity);
    expect(rules.stockShop).toBeTypeOf("function");
  });

  it("adds nothing for a mode without those traits", () => {
    expect(
      baseRunRules({ traits: { save: traits.save, onLoad: "title", music: traits.music } }),
    ).toBe(demoRunRules);
  });

  it("lets the run stock its own shop when it enters one with no stock", () => {
    const stocked = toShop(run(baseRunRules({ traits })));
    expect(stocked.inShop).toBe(true);
    const size = stocked.state.shopStock?.length ?? 0;
    expect(size).toBeGreaterThanOrEqual(traits.shop!.minOffers);
    expect(size).toBeLessThanOrEqual(traits.shop!.maxOffers);
    // A run whose rules don't stock shops enters an empty one.
    expect(toShop(run(demoRunRules)).state.shopStock).toBeUndefined();
  });

  it("stocks a shop restored from a save made before offers existed", () => {
    const rules = baseRunRules({ traits });
    const saved = toShop(run(demoRunRules)).snapshot();
    const restored = GameRun.fromSnapshot(dealerRegistry, rules, standardDeck, saved, () => 0);
    expect(restored.state.shopStock?.length).toBeGreaterThan(0);
  });

  it("lets a test-only trait contribution shape the rules without touching the controller", () => {
    const original = modeTraitRules.console;
    modeTraitRules.console = (rules) => ({ ...rules, stageReward: 9 });
    try {
      expect(baseRunRules({ traits: { ...traits, console: { name: "x" } } }).stageReward).toBe(9);
    } finally {
      modeTraitRules.console = original;
    }
  });

  it("refuses a sale once the run is over or while a won stage's rewards are unpaid", () => {
    const game = run(demoRunRules);
    expect(game.canSellPassives).toBe(true);
    game.forceOutcome("won");
    expect(game.canSellPassives).toBe(false);
    game.claimStageRewards();
    expect(game.canSellPassives).toBe(true);
    const lost = run(demoRunRules);
    lost.forceOutcome("lost");
    lost.advance();
    expect(lost.canSellPassives).toBe(false);
  });
});
