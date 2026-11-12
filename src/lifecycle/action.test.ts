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
    // The smallest budget the scrapper's discard needs: listener, rule handlers and command.
    let needed = 0;
    while (true) {
      const { game, hand } = limitedRun({ events: 128, operations: needed });
      if (game.discard(hand.map(({ id }) => id)) !== null) break;
      needed++;
    }
    // One less, and the last operation, its add-coins command, is the one refused.
    const { game, hand } = limitedRun({ events: 128, operations: needed - 1 });
    const before = game.state;
    expect(game.discard(hand.map(({ id }) => id))).toBeNull();
    expect(game.state).toBe(before);
    expect((game.actionFailure as ResolutionBudgetExceeded).registration).toBe("command add-coins");
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
    const pairPlay = (rack: readonly PassiveBlock[], operations: number) => {
      const { game, hand } = scoringRun(rack, operations);
      const pair = hand.slice(0, 2).map(({ id }) => id);
      return { game, played: game.play({ cardId: pair[0]!, cardIds: pair }) };
    };
    // The smallest budget the plain pair play needs (its reaction checks and the like).
    let needed = 0;
    while (pairPlay([], needed).played === null) needed++;
    // With a scoring rule in the rack, that budget is no longer enough: its rules count too.
    const withRule = pairPlay([createPassiveBlock("double-line", "p.1")], needed);
    expect(withRule.played).toBeNull();
    expect(withRule.game.actionFailure).toBeInstanceOf(ResolutionBudgetExceeded);
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

describe("discard rules count against the budget (#661 review)", () => {
  it("charges every rule a listener evaluates, even ones whose conditions fail", () => {
    const rules = Array.from({ length: 5 }, () => ({
      on: "discard.completed",
      select: { id: "event-blocks", config: { where: { id: "always", config: {} } } },
      where: { id: "count-at-least", config: { minimum: 99 } },
      effects: [{ id: "add-coins", config: { amount: 1 } }],
    }));
    const listener: PassiveBlock = {
      ...createPassiveBlock("scrapper", "many.1"),
      traits: {
        ...createPassiveBlock("scrapper", "many.1").traits,
        passive: { traitId: "passive.event-rules", eventRules: rules },
      },
    };
    const config = {
      ...sandboxRunRules(demoRunRules),
      resolutionLimits: { events: 128, operations: 3 },
    };
    const opening = new GameRun(dealerRegistry, config, standardDeck, () => 0);
    opening.installPassive(listener);
    const game = GameRun.fromSnapshot(
      dealerRegistry,
      config,
      standardDeck,
      opening.snapshot(),
      () => 0,
    );
    // One listener operation plus five rule evaluations: more than three.
    expect(game.discard([game.state.hand[0]!.id])).toBeNull();
    expect(game.actionFailure).toBeInstanceOf(ResolutionBudgetExceeded);
  });
});

describe("reaction checks count against the budget (#661 review)", () => {
  it("charges a reaction matcher even when it matches nothing", async () => {
    const { reactionMatchers } = await import("../reactions");
    const { resolveReactions } = await import("../reactions");
    const { withOperationCounter } = await import("./operations");
    const charged: string[] = [];
    if (!reactionMatchers.has("test.never")) reactionMatchers.register("test.never", () => false);
    const game = new GameRun(dealerRegistry, sandboxRunRules(demoRunRules), standardDeck, () => 0);
    game.play({ cardId: game.state.hand[0]!.id });
    withOperationCounter(
      (registration) => void charged.push(registration),
      () =>
        resolveReactions(game.state, () => [
          { when: { id: "test.never", config: {} }, results: [] },
        ]),
    );
    expect(charged).toEqual(["reaction matcher test.never"]);
  });
});

describe("each handler a rule invokes counts (#661 review)", () => {
  it("charges a rule's selector, condition and every effect, not one per rule", async () => {
    const { ruleHandlers } = await import("../rule-handlers");
    const { withOperationCounter } = await import("./operations");
    const charged: string[] = [];
    const rule = {
      on: "test.event",
      select: { id: "event-blocks", config: { where: { id: "always", config: {} } } },
      where: { id: "always", config: {} },
      effects: Array.from({ length: 5 }, () => ({ id: "add-block-value", config: { amount: 1 } })),
    };
    withOperationCounter(
      (registration) => void charged.push(registration),
      () =>
        ruleHandlers.evaluate(rule, {
          event: { type: "test.event", blocks: [] },
          workingValue: 0,
          exponent: 1,
          powerBase: 0,
          commands: [],
        }),
    );
    expect(charged.filter((name) => name.startsWith("effect "))).toHaveLength(5);
    expect(charged).toContain("selector event-blocks");
    expect(charged).toContain("condition always");
  });
});

describe("a caller's automatic-looking ID is remembered (#661 review)", () => {
  it("rejects auto:1 submitted twice, and never generates it afterwards, across Continue too", () => {
    const ledger = new ActionLedger();
    ledger.remember("auto:1");
    expect(ledger.has("auto:1")).toBe(true);
    expect(ledger.next("play")).not.toBe("auto:1");
    const restored = ActionLedger.restore(ledger.state);
    expect(restored.has("auto:1")).toBe(true);
  });
});
