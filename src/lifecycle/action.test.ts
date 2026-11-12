import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "../cards";
import { dealerRegistry } from "../dealer";
import { GameRun } from "../game-run";
import { createPassiveBlock, passiveTraits, type PassiveBlock } from "../passives";
import { Randomizer } from "../random";
import { demoRunRules, sandboxRunRules } from "../run-rules";
import { ActionContext, ResolutionBudgetExceeded, deepFreeze } from "./action";

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
