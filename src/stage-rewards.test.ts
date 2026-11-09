import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { makeDevDeck, materialOf } from "./materials";
import { createPassiveBlock } from "./passives";
import { fromSaveRecord, toSaveRecord } from "./save";
import { demoRunRules } from "./run-rules";
import { ledgerTotal, stageCompleteBonus, stageRewardLedger } from "./stage-rewards";

const newRun = (cards = standardDeck) => new GameRun(dealerRegistry, demoRunRules, cards, () => 0);

describe("stage rewards", () => {
  it("pays the four-coin completion bonus once, however often it is asked", () => {
    const game = newRun();
    expect(game.claimStageRewards()).toBeNull(); // not won yet
    game.forceOutcome("won");
    const first = game.claimStageRewards()!;
    expect(first.entries).toEqual([
      { source: "stage.complete", label: "Stage complete bonus", coins: stageCompleteBonus },
    ]);
    expect(first.balanceBefore).toBe(0);
    expect(first.balance).toBe(4);
    expect(game.claimStageRewards()).toEqual(first);
    game.advance(); // advancing does not pay again
    expect(game.state.coins).toBe(4);
  });

  it("pays nothing for a lost stage", () => {
    const game = newRun();
    game.forceOutcome("lost");
    expect(game.claimStageRewards()).toBeNull();
    game.advance();
    expect(game.state.coins).toBe(0);
  });

  it("adds a row for a passive that pays per gold block left in the hand", () => {
    const deck = makeDevDeck(3);
    const game = newRun(deck);
    game.installPassive(createPassiveBlock("gold-standard", "passive.gold"));
    const golds = deck.filter((block) => materialOf(block) === "gold").slice(0, 2);
    const other = deck.find((block) => materialOf(block) === "wood")!;
    const entries = stageRewardLedger({ ...game.state, hand: [...golds, other] });
    expect(entries).toEqual([
      { source: "stage.complete", label: "Stage complete bonus", coins: 4 },
      { source: "passive.gold-standard", label: "Gold Standard", coins: 2 },
    ]);
    expect(ledgerTotal(entries)).toBe(6);
    // No gold in hand: the passive pays nothing and gets no row.
    expect(stageRewardLedger({ ...game.state, hand: [other] })).toHaveLength(1);
  });

  it("is not paid again after a save and reload", () => {
    const game = newRun();
    game.forceOutcome("won");
    game.claimStageRewards();
    const record = JSON.parse(JSON.stringify(toSaveRecord(game.snapshot())));
    const snapshot = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    const resumed = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, snapshot);
    expect(resumed.claimStageRewards()?.balance).toBe(4);
    expect(resumed.state.coins).toBe(4);
  });
});
