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
  it("pays the four-coin completion bonus, and a coin per unused play, once however often it is asked", () => {
    const game = newRun();
    expect(game.claimStageRewards()).toBeNull(); // not won yet
    game.forceOutcome("won");
    const first = game.claimStageRewards()!;
    expect(first.entries).toEqual([
      { source: "stage.complete", label: "Stage complete bonus", coins: stageCompleteBonus },
      // Won with all six plays to spare: a coin each.
      { source: "stage.unusedPlays", label: "Unused plays (6)", coins: 6 },
    ]);
    expect(first.balanceBefore).toBe(0);
    expect(first.balance).toBe(10);
    expect(game.claimStageRewards()).toEqual(first);
    game.advance(); // advancing does not pay again
    expect(game.state.coins).toBe(10);
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
      { source: "stage.unusedPlays", label: "Unused plays (6)", coins: 6 },
      { source: "material.gold", label: "Gold held in hand", coins: 4 },
      { source: "passive.gold-standard", label: "Gold Standard", coins: 2 },
    ]);
    expect(ledgerTotal(entries)).toBe(16);
    // No gold in hand: the passive pays nothing and gets no row.
    expect(stageRewardLedger({ ...game.state, hand: [other] })).toHaveLength(2);
    // No plays left: no unused-plays row.
    const spent = { ...game.state, round: { ...game.state.round, movesLeft: 0 }, hand: [other] };
    expect(stageRewardLedger(spent)).toHaveLength(1);
  });

  it("is not paid again after a save and reload", () => {
    const game = newRun();
    game.forceOutcome("won");
    game.claimStageRewards();
    const record = JSON.parse(JSON.stringify(toSaveRecord(game.snapshot())));
    const snapshot = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    const resumed = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, snapshot);
    expect(resumed.claimStageRewards()?.balance).toBe(10);
    expect(resumed.state.coins).toBe(10);
  });

  it.each(["won", "lost"] as const)(
    "pays one held Gold on %s, before cards return to the deck",
    (outcome) => {
      const cards = makeDevDeck(3);
      const opening = newRun(cards).snapshot();
      const all = [...opening.state.hand, ...opening.state.deck];
      const [held, placed, discarded] = all.filter((card) => materialOf(card) === "gold");
      const paper = all.find((card) => materialOf(card) === "paper")!;
      const chosen = new Set([held.id, placed.id, discarded.id, paper.id]);
      const snapshot = {
        ...opening,
        state: {
          ...opening.state,
          field: [{ block: placed, cell: { x: 0, y: 0, z: 0 } }],
          hand: [held, paper],
          deck: all.filter((card) => !chosen.has(card.id)),
          discardPile: [discarded],
        },
      };
      const game = GameRun.fromSnapshot(dealerRegistry, demoRunRules, cards, snapshot);
      if (outcome === "won")
        game.installPassive(createPassiveBlock("gold-standard", "passive.gold"));
      if (outcome === "lost") {
        const automatic = GameRun.fromSnapshot(dealerRegistry, demoRunRules, cards, snapshot);
        automatic.forceOutcome("lost");
        automatic.advance();
        expect(automatic.phase).toBe("over");
        expect(automatic.state.coins).toBe(2);
      }
      game.forceOutcome(outcome);
      const reward = game.claimStageRewards()!;
      expect(reward.entries).toEqual(
        outcome === "won"
          ? [
              { source: "stage.complete", label: "Stage complete bonus", coins: 4 },
              { source: "stage.unusedPlays", label: "Unused plays (6)", coins: 6 },
              { source: "material.gold", label: "Gold held in hand", coins: 2 },
              { source: "passive.gold-standard", label: "Gold Standard", coins: 1 },
            ]
          : [{ source: "material.gold", label: "Gold held in hand", coins: 2 }],
      );
      expect(reward.balance).toBe(outcome === "won" ? 13 : 2);
      expect(game.claimStageRewards()).toEqual(reward);
      const record = JSON.parse(JSON.stringify(toSaveRecord(game.snapshot())));
      const restored = fromSaveRecord(record, cards, dealerRegistry)!;
      const resumed = GameRun.fromSnapshot(dealerRegistry, demoRunRules, cards, restored);
      expect(resumed.claimStageRewards()).toEqual(reward);
      resumed.advance();
      expect(resumed.state.coins).toBe(reward.balance);
    },
  );

  it("does not reward Gold already played or discarded", () => {
    const cards = makeDevDeck(3);
    const opening = newRun(cards).snapshot();
    const all = [...opening.state.hand, ...opening.state.deck];
    const [placed, discarded] = all.filter((card) => materialOf(card) === "gold");
    const paper = all.find((card) => materialOf(card) === "paper")!;
    const chosen = new Set([placed.id, discarded.id, paper.id]);
    const game = GameRun.fromSnapshot(dealerRegistry, demoRunRules, cards, {
      ...opening,
      state: {
        ...opening.state,
        field: [{ block: placed, cell: { x: 0, y: 0, z: 0 } }],
        hand: [paper],
        deck: all.filter((card) => !chosen.has(card.id)),
        discardPile: [discarded],
      },
    });
    game.forceOutcome("won");
    expect(game.claimStageRewards()!.entries).toEqual([
      { source: "stage.complete", label: "Stage complete bonus", coins: 4 },
      { source: "stage.unusedPlays", label: "Unused plays (6)", coins: 6 },
    ]);
  });
});
