import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { makeDevDeck, materialOf } from "./materials";
import { createPassiveBlock } from "./passives";
import { registerRuleCommand, ruleCommands } from "./rule-commands";
import { fromSaveRecord, toSaveRecord } from "./save";
import { demoRunRules } from "./run-rules";
import {
  coinEntry,
  ledgerTotal,
  rewardEffects,
  stageCompleteBonus,
  stageRewardLedger,
} from "./stage-rewards";

const newRun = (cards = standardDeck) => new GameRun(dealerRegistry, demoRunRules, cards, () => 0);

describe("stage rewards", () => {
  it("pays the four-coin completion bonus, and a coin per unused play, once however often it is asked", () => {
    const game = newRun();
    expect(game.claimStageRewards()).toBeNull(); // not won yet
    game.forceOutcome("won");
    const first = game.claimStageRewards()!;
    expect(first.entries).toEqual([
      coinEntry("stage.complete", "Stage complete bonus", stageCompleteBonus),
      // Won with all six plays to spare: a coin each.
      coinEntry("stage.unusedPlays", "Unused plays (6)", 6),
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
      coinEntry("stage.complete", "Stage complete bonus", 4),
      coinEntry("stage.unusedPlays", "Unused plays (6)", 6),
      coinEntry("material.gold", "Gold held in hand", 4),
      coinEntry("passive.gold-standard", "Gold Standard", 2),
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
              coinEntry("stage.complete", "Stage complete bonus", 4),
              coinEntry("stage.unusedPlays", "Unused plays (6)", 6),
              coinEntry("material.gold", "Gold held in hand", 2),
              coinEntry("passive.gold-standard", "Gold Standard", 1),
            ]
          : [coinEntry("material.gold", "Gold held in hand", 2)],
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
      coinEntry("stage.complete", "Stage complete bonus", 4),
      coinEntry("stage.unusedPlays", "Unused plays (6)", 6),
    ]);
  });
});

describe("typed reward entries (#729)", () => {
  // A non-cash effect, registered for the test: it adds nothing to the coin total.
  if (!rewardEffects.has("test.trophy"))
    rewardEffects.register("test.trophy", {
      coins: () => 0,
      validate: (config) => {
        if (typeof (config as { name?: unknown })?.name !== "string") throw new Error("bad trophy");
        return config;
      },
    });
  const trophy = {
    source: "test.trophy",
    label: "Trophy",
    effects: [{ id: "test.trophy", config: { name: "cup" } }],
    presentation: "coins",
  };

  it("totals only coin effects: a non-cash row adds nothing and is no zero-coin row", () => {
    const entries = [coinEntry("stage.complete", "Stage complete bonus", 4), trophy];
    expect(ledgerTotal(entries)).toBe(4);
    expect(trophy.effects.some(({ id }) => id === "coins")).toBe(false);
  });

  it("formats and cues a row through its registered presentation", async () => {
    const { rewardPresentations } = await import("./reward-presentation");
    const row = coinEntry("stage.complete", "Stage complete bonus", 1);
    expect(rewardPresentations.get(row.presentation).value(row)).toBe("+1 coin");
    expect(rewardPresentations.get(row.presentation).cue).toBe("reward.coin");
  });

  /** A paid run's save record, with its ledger rows replaced. */
  const savedWith = (entries: unknown[], balanceDelta: number) => {
    const game = newRun();
    game.forceOutcome("won");
    game.claimStageRewards();
    const record = JSON.parse(JSON.stringify(toSaveRecord(game.snapshot())));
    record.rewarded.reward.entries = entries;
    record.rewarded.reward.balance = record.rewarded.reward.balanceBefore + balanceDelta;
    return record;
  };

  it("reads an older coin-only ledger as the same coin rows, never paying again", () => {
    const record = savedWith(
      [
        { source: "stage.complete", label: "Stage complete bonus", coins: 4 },
        { source: "stage.unusedPlays", label: "Unused plays (6)", coins: 6 },
      ],
      10,
    );
    const snapshot = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    expect(snapshot.rewarded!.reward.entries).toEqual([
      coinEntry("stage.complete", "Stage complete bonus", 4),
      coinEntry("stage.unusedPlays", "Unused plays (6)", 6),
    ]);
    const resumed = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, snapshot);
    const coins = resumed.state.coins;
    resumed.claimStageRewards();
    expect(resumed.state.coins).toBe(coins);
  });

  it("keeps a typed mixed receipt through save and reload", () => {
    const record = savedWith([coinEntry("stage.complete", "Stage complete bonus", 4), trophy], 4);
    const snapshot = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    expect(snapshot.rewarded!.reward.entries).toEqual([
      coinEntry("stage.complete", "Stage complete bonus", 4),
      trophy,
    ]);
  });

  it("refuses malformed receipts: the save is rejected, never read as a payout", () => {
    const read = (entries: unknown[], delta = 0) =>
      fromSaveRecord(savedWith(entries, delta), standardDeck, dealerRegistry);
    // Control: a well-formed receipt is read.
    expect(read([coinEntry("a", "A", 3)], 3)).not.toBeNull();
    expect(read([{ ...trophy, effects: [{ id: "nope", config: {} }] }])).toBeNull();
    expect(read([{ ...trophy, effects: [{ id: "test.trophy", config: {} }] }])).toBeNull();
    expect(
      read([{ ...coinEntry("a", "A", 1), effects: [{ id: "coins", config: { amount: -1 } }] }]),
    ).toBeNull();
    expect(read([{ ...trophy, presentation: "" }])).toBeNull();
    // Named, but not a registered presentation: refused at load, not when the row is shown.
    expect(read([{ ...trophy, presentation: "missing" }])).toBeNull();
    expect(read([{ source: "a", label: "A", coins: 1.5 }], 1.5)).toBeNull();
    // A balance that disagrees with the coin effects.
    expect(read([coinEntry("a", "A", 3)], 2)).toBeNull();
  });
});

describe("object grants settle atomically and exactly once (#730)", () => {
  /** A run whose randomness is a seeded, checkpointed stream, as the run controller attaches. */
  const seededRun = async () => {
    const { Randomizer } = await import("./random");
    const randomizer = new Randomizer(42);
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => randomizer.next());
    game.attachRandomCheckpoints(randomizer);
    game.forceOutcome("won");
    return { game, randomizer };
  };
  const grantPassive = {
    source: "test.grant",
    label: "A passive",
    effects: [{ id: "grant", config: { command: { id: "grant-unowned-passive", config: {} } } }],
    presentation: "coins",
  };

  it("pays the coins, commits the grant once, and records what it granted", async () => {
    const { game } = await seededRun();
    const before = { coins: game.state.coins, rack: game.state.passiveRack.length };
    const reward = game.settleStageRewards([
      coinEntry("stage.complete", "Bonus", 4),
      grantPassive,
    ])!;
    expect(game.state.coins).toBe(before.coins + 4);
    expect(reward.balance - reward.balanceBefore).toBe(4);
    expect(game.state.passiveRack).toHaveLength(before.rack + 1);
    const granted = (reward.entries[1]!.effects[0]!.config as { granted: string[] }).granted;
    expect(granted).toEqual([game.state.passiveRack.at(-1)!.id]);
    // Settling again, or claiming, returns the same receipt and grants nothing more.
    expect(game.settleStageRewards([grantPassive])).toBe(reward);
    expect(game.claimStageRewards()).toBe(reward);
    expect(game.state.passiveRack).toHaveLength(before.rack + 1);
    expect(game.state.coins).toBe(before.coins + 4);
  });

  it("keeps the receipt through save and Continue, and never grants again", async () => {
    const { game } = await seededRun();
    game.settleStageRewards([grantPassive]);
    const rack = game.state.passiveRack.length;
    const record = JSON.parse(JSON.stringify(toSaveRecord(game.snapshot())));
    const snapshot = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    const resumed = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, snapshot);
    const receipt = resumed.claimStageRewards()!;
    expect((receipt.entries[0]!.effects[0]!.config as { granted: string[] }).granted).toHaveLength(
      1,
    );
    expect(resumed.settleStageRewards([grantPassive])).toEqual(receipt);
    expect(resumed.state.passiveRack).toHaveLength(rack);
  });

  it("rolls everything back when a grant fails: no coins, no object, no marker, no draws", async () => {
    if (!ruleCommands.has("test-grant-then-fail"))
      registerRuleCommand("test-grant-then-fail", (_config, target) => {
        target.grantUnownedPassive();
        throw new Error("grant failed");
      });
    const { game, randomizer } = await seededRun();
    const before = { state: game.state, cursor: randomizer.cursor };
    const failing = {
      ...grantPassive,
      effects: [{ id: "grant", config: { command: { id: "test-grant-then-fail", config: {} } } }],
    };
    expect(game.settleStageRewards([coinEntry("stage.complete", "Bonus", 4), failing])).toBeNull();
    expect(game.state).toBe(before.state);
    expect(randomizer.cursor).toBe(before.cursor);
    expect(game.stageReward).toBeNull();
    // Nothing was paid, so a later settlement can still pay: the same grant, now succeeding,
    // picks the same passive a run that never failed would have, as the stream was restored.
    const retried = game.settleStageRewards([
      coinEntry("stage.complete", "Bonus", 4),
      grantPassive,
    ])!;
    const clean = (await seededRun()).game;
    const fresh = clean.settleStageRewards([
      coinEntry("stage.complete", "Bonus", 4),
      grantPassive,
    ])!;
    const definition = (run: GameRun) => run.state.passiveRack.at(-1)!.definitionId;
    expect(retried.balance - retried.balanceBefore).toBe(4);
    expect(definition(game)).toBe(definition(clean));
    expect(fresh.entries[1]!.effects[0]!.config).toEqual(retried.entries[1]!.effects[0]!.config);
  });

  it("refuses a malformed grant receipt at load", async () => {
    const { game } = await seededRun();
    game.settleStageRewards([grantPassive]);
    const record = JSON.parse(JSON.stringify(toSaveRecord(game.snapshot())));
    const effect = record.rewarded.reward.entries[0].effects[0];
    const read = () => fromSaveRecord(record, standardDeck, dealerRegistry);
    expect(read()).not.toBeNull();
    effect.config.granted = [42];
    expect(read()).toBeNull();
    effect.config = { command: { id: "no-such-command", config: {} } };
    expect(read()).toBeNull();
  });
});

describe("settlement review fixes (#740 review)", () => {
  it("settles only a decided stage, never mid-play", () => {
    const game = newRun();
    const coins = game.state.coins;
    expect(game.settleStageRewards([coinEntry("stage.complete", "Bonus", 4)])).toBeNull();
    expect(game.state.coins).toBe(coins);
    expect(game.stageReward).toBeNull();
    // The stage's normal rewards are still paid when it is won.
    game.forceOutcome("won");
    expect(game.claimStageRewards()!.entries[0]!.source).toBe("stage.complete");
  });

  it("delivers and records the facts a grant's command reports", async () => {
    const { Randomizer } = await import("./random");
    const randomizer = new Randomizer(42);
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => randomizer.next());
    game.attachRandomCheckpoints(randomizer);
    game.forceOutcome("won");
    game.settleStageRewards([
      {
        source: "test.grant",
        label: "A passive",
        effects: [
          { id: "grant", config: { command: { id: "grant-unowned-passive", config: {} } } },
        ],
        presentation: "coins",
      },
    ]);
    const types = game.actionFacts.map(({ type }) => type);
    expect(types).toContain("passive.installed");
    expect(types.indexOf("passive.installed")).toBeLessThan(types.indexOf("reward.finalized"));
  });
});

describe("a failed settlement holds the run on the stage (#740 review)", () => {
  it("does not advance past a stage whose settlement rolled back", () => {
    // An operation budget too small for settlement: it rolls back.
    const tight = { ...demoRunRules, resolutionLimits: { events: 128, operations: 0 } };
    const game = new GameRun(dealerRegistry, tight, standardDeck, () => 0);
    game.forceOutcome("won");
    const coins = game.state.coins;
    expect(game.advance()).toBe(false);
    expect(game.state.coins).toBe(coins);
    // Still on the decided stage, unpaid: a later settlement can pay it.
    expect(game.stageRewardsPending).toBe(true);
  });

  it("still advances a lost stage that has nothing to pay", () => {
    const game = newRun();
    game.forceOutcome("lost");
    expect(game.advance()).toBe(true);
  });
});

describe("grant receipts (#740 review)", () => {
  it("rolls back a grant that produced nothing, leaving the stage to settle again", async () => {
    if (!ruleCommands.has("test-grant-nothing"))
      registerRuleCommand("test-grant-nothing", () => []);
    const game = newRun();
    game.forceOutcome("won");
    const coins = game.state.coins;
    const nothing = {
      source: "test.grant",
      label: "Nothing",
      effects: [{ id: "grant", config: { command: { id: "test-grant-nothing", config: {} } } }],
      presentation: "coins",
    };
    expect(game.settleStageRewards([coinEntry("stage.complete", "Bonus", 4), nothing])).toBeNull();
    expect(game.state.coins).toBe(coins);
    expect(game.stageRewardsPending).toBe(true);
  });

  it("commits a passive's rule on a grant's fact inside the settlement", async () => {
    const { Randomizer } = await import("./random");
    const { createPassiveBlock } = await import("./passives");
    const randomizer = new Randomizer(42);
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => randomizer.next());
    game.attachRandomCheckpoints(randomizer);
    const base = createPassiveBlock("scrapper", "listener.1");
    game.installPassive({
      ...base,
      traits: {
        ...base.traits,
        passive: {
          traitId: "passive.event-rules",
          eventRules: [
            {
              on: "passive.installed",
              select: { id: "event-blocks", config: { where: { id: "always", config: {} } } },
              where: { id: "always", config: {} },
              effects: [{ id: "add-coins", config: { amount: 7 } }],
            },
          ],
        },
      },
    } as unknown as typeof base);
    game.forceOutcome("won");
    const coins = game.state.coins;
    game.settleStageRewards([
      {
        source: "test.grant",
        label: "A passive",
        effects: [
          { id: "grant", config: { command: { id: "grant-unowned-passive", config: {} } } },
        ],
        presentation: "coins",
      },
    ]);
    expect(game.state.coins).toBe(coins + 7);
    // The receipt's balance matches the wallet (#740 review).
    expect(game.stageReward!.balance).toBe(game.state.coins);
  });

  it("refuses a saved grant receipt that records nothing granted", async () => {
    const { Randomizer } = await import("./random");
    const randomizer = new Randomizer(42);
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => randomizer.next());
    game.attachRandomCheckpoints(randomizer);
    game.forceOutcome("won");
    game.settleStageRewards([
      {
        source: "test.grant",
        label: "A passive",
        effects: [
          { id: "grant", config: { command: { id: "grant-unowned-passive", config: {} } } },
        ],
        presentation: "coins",
      },
    ]);
    const record = JSON.parse(JSON.stringify(toSaveRecord(game.snapshot())));
    expect(fromSaveRecord(record, standardDeck, dealerRegistry)).not.toBeNull();
    delete record.rewarded.reward.entries[0].effects[0].config.granted;
    expect(fromSaveRecord(record, standardDeck, dealerRegistry)).toBeNull();
  });
});
