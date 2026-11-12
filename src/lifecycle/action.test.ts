import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "../cards";
import { dealerRegistry } from "../dealer";
import { GameRun } from "../game-run";
import { createPassiveBlock, passiveTraits, type PassiveBlock } from "../passives";
import { Randomizer } from "../random";
import { demoRunRules, sandboxRunRules } from "../run-rules";
import { ActionContext, ActionLedger, ResolutionBudgetExceeded, deepFreeze } from "./action";

describe("captured facts (#657)", () => {
  it("are deeply immutable copies: the live data can change, the fact cannot", () => {
    const live = { blocks: [{ id: "a", tags: ["x"] }] };
    const action = new ActionContext("play-1", 3);
    const fact = action.record("block.placed", live, { phase: "placement", subjectIds: ["a"] });
    live.blocks[0]!.tags.push("later");
    expect(fact.payload.blocks[0]!.tags).toEqual(["x"]);
    expect(Object.isFrozen(fact.payload.blocks[0]!.tags)).toBe(true);
    expect(() => (fact.payload.blocks as unknown[]).push({})).toThrow();
    // The live data itself was never frozen.
    expect(Object.isFrozen(live.blocks)).toBe(false);
  });

  it("correlate by action, sequence, parent, phase, batch and subjects", () => {
    const action = new ActionContext("play-7", 12);
    const batch = action.record("play.placed", {}, { phase: "placement", batchId: "b1" });
    const placed = action.record(
      "block.placed",
      {},
      {
        phase: "placement",
        parent: batch,
        batchId: "b1",
        subjectIds: ["card-1"],
      },
    );
    expect(placed).toMatchObject({
      actionId: "play-7",
      sequence: 1,
      parentId: batch.eventId,
      phase: "placement",
      batchId: "b1",
      subjectIds: ["card-1"],
      snapshotVersion: 12,
    });
    expect(action.facts.map(({ type }) => type)).toEqual(["play.placed", "block.placed"]);
  });

  it("deepFreeze leaves functions alone and freezes nested containers", () => {
    const fn = () => 1;
    const value = deepFreeze({ list: [{ n: 1 }], fn });
    expect(Object.isFrozen(value.list[0])).toBe(true);
    expect(Object.isFrozen(fn)).toBe(false);
  });
});

describe("the action budget (#657)", () => {
  it("reports the ancestry, phase and registration when it runs out", () => {
    const action = new ActionContext("play-1", 0, { events: 2, operations: 10 });
    action.deliver({ type: "a" }, "play", []);
    action.deliver({ type: "b" }, "play", ["a"]);
    expect(() => action.deliver({ type: "c" }, "play", ["a", "b"])).toThrow(
      ResolutionBudgetExceeded,
    );
    try {
      action.deliver({ type: "d" }, "play", ["a", "b", "c"]);
    } catch (error) {
      expect((error as ResolutionBudgetExceeded).ancestry).toEqual(["a", "b", "c", "d"]);
      expect((error as ResolutionBudgetExceeded).phase).toBe("play");
    }
  });
});

const card = (rank: string, suit: string): CardBlock =>
  standardDeck.find(
    (block) => block.traits.identity.rank === rank && block.traits.identity.suit.name === suit,
  )!;

/** A test passive whose trait responds to discards with `respond`. */
function testPassive(traitId: string, respond: () => readonly { type: string }[]): PassiveBlock {
  if (!passiveTraits.has(traitId))
    passiveTraits.register(traitId, {
      id: traitId,
      listensTo: ["discard.completed", "test.echo"],
      respond: () => respond(),
    });
  const base = createPassiveBlock("scrapper", `${traitId}.1`);
  return { ...base, traits: { ...base.traits, passive: { traitId } } };
}

function runWith(rack: readonly PassiveBlock[], randomizer: Randomizer) {
  const hand = [card("2", "clubs"), card("3", "clubs")];
  const opening = new GameRun(dealerRegistry, sandboxRunRules(demoRunRules), standardDeck, () => 0);
  for (const block of rack) opening.installPassive(block);
  const game = GameRun.fromSnapshot(
    dealerRegistry,
    sandboxRunRules(demoRunRules),
    standardDeck,
    { ...opening.snapshot(), state: { ...opening.state, hand: [...hand] } },
    () => randomizer.next(),
  );
  game.attachRandomCheckpoints(randomizer);
  return { game, hand };
}

describe("an action is a transaction (#657)", () => {
  it("rolls state and the random cursor back together when a listener fails, publishing nothing", () => {
    const randomizer = new Randomizer(42);
    // The scrapper pays first; then a listener draws from the stream and fails.
    const failing = testPassive("test.draws-then-fails", () => {
      randomizer.next();
      randomizer.next();
      throw new Error("listener failed");
    });
    const { game, hand } = runWith([createPassiveBlock("scrapper", "s.1"), failing], randomizer);
    const before = { state: game.state, cursor: randomizer.cursor, facts: game.actionFacts };
    expect(game.discard(hand.map(({ id }) => id))).toBeNull();
    expect(game.state).toBe(before.state);
    expect(game.state.coins).toBe(before.state.coins);
    expect(randomizer.cursor).toBe(before.cursor);
    expect(game.actionFacts).toBe(before.facts);
    expect(game.lastDiscardEvents).toEqual([]);
    expect(game.actionFailure?.message).toBe("listener failed");
  });

  it("rolls back an action that exceeds its budget, with the diagnostic kept", () => {
    const randomizer = new Randomizer(7);
    const echo = testPassive("test.echoes", () => [{ type: "test.echo" }]);
    const { game, hand } = runWith([echo], randomizer);
    const before = game.state;
    expect(game.discard(hand.map(({ id }) => id))).toBeNull();
    expect(game.state).toBe(before);
    expect(game.actionFailure).toBeInstanceOf(ResolutionBudgetExceeded);
    expect((game.actionFailure as ResolutionBudgetExceeded).phase).toBe("discard");
  });

  it("commits a successful action with its facts, and rejects the same action ID again", () => {
    const randomizer = new Randomizer(1);
    const { game, hand } = runWith([createPassiveBlock("scrapper", "s.1")], randomizer);
    const ids = hand.map(({ id }) => id);
    expect(game.discard([ids[0]!], "discard-A")).not.toBeNull();
    expect(game.actionFacts[0]).toMatchObject({ type: "discard.completed", actionId: "discard-A" });
    const after = game.state;
    // The same submission again does nothing, even though it would otherwise be valid.
    expect(game.discard([ids[1]!], "discard-A")).toBeNull();
    expect(game.state).toBe(after);
  });

  it("an invalid action consumes nothing and records nothing", () => {
    const randomizer = new Randomizer(1);
    const { game } = runWith([], randomizer);
    const before = { state: game.state, facts: game.actionFacts };
    expect(game.discard(["not-in-hand"])).toBeNull();
    expect(game.state).toBe(before.state);
    expect(game.actionFacts).toBe(before.facts);
    expect(game.actionFailure).toBeNull();
  });
});

describe("the action budget reaches commands and outcomes (#661 review)", () => {
  const limitedRun = (limits: { events: number; operations: number }, plays = 1_000_000) => {
    const rules = { ...sandboxRunRules(demoRunRules), resolutionLimits: limits };
    const base = rules.stage.bind(rules);
    const config = {
      ...rules,
      stage: (round: number, kind: Parameters<typeof base>[1]) => ({
        ...base(round, kind),
        targetScore: 1_000_000,
        plays,
      }),
    };
    const hand = [card("2", "clubs"), card("3", "clubs")];
    const opening = new GameRun(dealerRegistry, config, standardDeck, () => 0);
    opening.installPassive(createPassiveBlock("scrapper", "s.1"));
    const game = GameRun.fromSnapshot(
      dealerRegistry,
      config,
      standardDeck,
      { ...opening.snapshot(), state: { ...opening.state, hand: [...hand] } },
      () => 0,
    );
    return { game, hand };
  };

  it("counts each command, so a listener's commands can exhaust the operation budget", () => {
    // The scrapper's listener is one operation and its add-coins command a second.
    const { game, hand } = limitedRun({ events: 128, operations: 1 });
    const before = game.state;
    expect(game.discard(hand.map(({ id }) => id))).toBeNull();
    expect(game.state).toBe(before);
    expect((game.actionFailure as ResolutionBudgetExceeded).registration).toBe("command add-coins");
    // With room for both, the same discard commits.
    const roomy = limitedRun({ events: 128, operations: 2 });
    expect(roomy.game.discard(roomy.hand.map(({ id }) => id))).not.toBeNull();
  });

  it("delivers a play's stage outcome inside the action, recording it as a fact", () => {
    // One play allowed and an unreachable target: the play loses the stage.
    const { game, hand } = limitedRun({ events: 128, operations: 4096 }, 1);
    expect(game.play({ cardId: hand[0]!.id })).not.toBeNull();
    expect(game.actionFacts.map(({ type }) => type)).toContain("stage.lost");
  });

  it("never generates an action ID a caller has already used", () => {
    // An explicit ID shaped like an automatic one, then an automatic discard: no collision.
    const first = limitedRun({ events: 128, operations: 4096 });
    expect(first.game.discard([first.hand[0]!.id], "discard-1")).not.toBeNull();
    expect(first.game.discard([first.hand[1]!.id])).not.toBeNull();
    // Even a caller using the automatic namespace is skipped, not collided with.
    const second = limitedRun({ events: 128, operations: 4096 });
    expect(second.game.discard([second.hand[0]!.id], "auto:1")).not.toBeNull();
    expect(second.game.discard([second.hand[1]!.id])).not.toBeNull();
  });
});

describe("follow-up facts name their cause (#661 review)", () => {
  it("records a command's result with the fact that caused it as its parent", () => {
    const randomizer = new Randomizer(3);
    const { game, hand } = runWith([createPassiveBlock("scrapper", "s.1")], randomizer);
    expect(game.discard(hand.map(({ id }) => id))).not.toBeNull();
    const completed = game.actionFacts.find(({ type }) => type === "discard.completed")!;
    const coins = game.actionFacts.find(({ type }) => type === "coins.gained")!;
    expect(completed.parentId).toBeNull();
    expect(coins.parentId).toBe(completed.eventId);
  });
});

describe("scoring rules and the duplicate ledger (#661 review)", () => {
  const scoringRun = (rack: readonly PassiveBlock[], operations: number) => {
    const config = {
      ...sandboxRunRules(demoRunRules),
      resolutionLimits: { events: 128, operations },
    };
    const opening = new GameRun(dealerRegistry, config, standardDeck, () => 0);
    for (const block of rack) opening.installPassive(block);
    const hand = [card("7", "hearts"), card("7", "spades"), card("2", "clubs")];
    return {
      game: GameRun.fromSnapshot(
        dealerRegistry,
        config,
        standardDeck,
        { ...opening.snapshot(), state: { ...opening.state, hand } },
        () => 0,
      ),
      hand,
    };
  };

  it("counts committed scoring rules against the play's operation budget", () => {
    // A pair of sevens as one line, so a line scores and the rack's scoring rule is evaluated.
    const withRule = scoringRun([createPassiveBlock("double-line", "p.1")], 0);
    const before = withRule.game.state;
    const pair = withRule.hand.slice(0, 2).map(({ id }) => id);
    expect(withRule.game.play({ cardId: pair[0]!, cardIds: pair })).toBeNull();
    expect(withRule.game.state).toBe(before);
    expect(withRule.game.actionFailure).toBeInstanceOf(ResolutionBudgetExceeded);
    // The same play with no scoring rule needs no operations, so it commits.
    const plain = scoringRun([], 0);
    const plainPair = plain.hand.slice(0, 2).map(({ id }) => id);
    expect(plain.game.play({ cardId: plainPair[0]!, cardIds: plainPair })).not.toBeNull();
  });

  it("remembers every resolved action ID for the run", () => {
    const ledger = new ActionLedger();
    ledger.remember("first");
    for (let i = 0; i < 300; i++) ledger.remember(ledger.next("play"));
    expect(ledger.has("first")).toBe(true);
  });
});

describe("action identity survives save and Continue (#661 review)", () => {
  it("still rejects a used ID, and never reissues an automatic one", async () => {
    const { fromSaveRecord, toSaveRecord } = await import("../save");
    // An ordinary run (its cards all accounted for, as the save validator requires).
    const game = new GameRun(dealerRegistry, sandboxRunRules(demoRunRules), standardDeck, () => 0);
    const hand = game.state.hand;
    expect(game.discard([hand[0]!.id], "mine")).not.toBeNull();
    expect(game.discard([hand[1]!.id])).not.toBeNull();
    const usedAuto = game.actionFacts[0]!.actionId;
    // Through the real save pipeline, as Continue does.
    const record = JSON.parse(JSON.stringify(toSaveRecord(game.snapshot())));
    const snapshot = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    const restored = GameRun.fromSnapshot(
      dealerRegistry,
      sandboxRunRules(demoRunRules),
      standardDeck,
      snapshot,
      () => 0,
    );
    const card = restored.state.hand[0]!;
    // The explicit ID is still spent, even though the request would otherwise be valid.
    expect(restored.discard([card.id], "mine")).toBeNull();
    // A fresh automatic action gets an ID never used before the save.
    expect(restored.discard([card.id])).not.toBeNull();
    expect(restored.actionFacts[0]!.actionId).not.toBe(usedAuto);
    expect(restored.actionFacts[0]!.actionId).not.toBe("mine");
  });
});

describe("automatic IDs compare in full (#661 review)", () => {
  it("does not alias a caller's ID with an automatic one of the same number", () => {
    const ledger = new ActionLedger();
    ledger.remember(ledger.next("discard"));
    // Shaped like the old automatic form, but never resolved: not a duplicate.
    expect(ledger.has("auto:play-1")).toBe(false);
    expect(ledger.has("auto:1")).toBe(true);
  });
});

describe("the ledger's rule is the same before and after Continue (#661 review)", () => {
  it("treats an issued automatic ID as spent either way, and a caller's own only once resolved", () => {
    const ledger = new ActionLedger();
    const unresolved = ledger.next("play");
    ledger.remember("mine");
    const restored = ActionLedger.restore(ledger.state);
    for (const which of [ledger, restored]) {
      expect(which.has(unresolved)).toBe(true);
      expect(which.has("mine")).toBe(true);
      expect(which.has("theirs")).toBe(false);
    }
  });
});
