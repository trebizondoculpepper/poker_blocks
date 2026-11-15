import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { describeCommand, executeCommand, type CommittedMetadata } from "./command-codecs";
import { dealerRegistry } from "./dealer";
import { scenarioReplayCommands } from "./dev-scenario";
import { GameRun } from "./game-run";
import type { EventEnvelope } from "./lifecycle/action";
import { demoRunRules } from "./run-rules";

const fresh = () => new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0);

function recording(run: GameRun) {
  const seen: { facts: readonly EventEnvelope[]; metadata: CommittedMetadata }[] = [];
  run.onCommitted((facts, metadata) => seen.push({ facts, metadata }));
  return seen;
}

const commands = (seen: ReturnType<typeof recording>) =>
  seen.map(({ metadata }) => (metadata.command as { command: string }).command);

describe("refill as its own journalled command (#1244; doc/experiments/command-journal.md)", () => {
  it("publishes a drawing refill after the play it follows, with no facts and its own action", () => {
    const run = fresh();
    const seen = recording(run);
    const size = run.state.hand.length;
    run.play({ cardId: run.state.hand[0]!.id });
    const drawn = run.refillHand();
    expect(drawn).toHaveLength(1);
    expect(run.state.hand).toHaveLength(size);
    expect(commands(seen)).toEqual(["play", "refillHand"]);
    const refill = seen[1]!;
    expect(refill.facts).toEqual([]);
    expect(refill.metadata).toMatchObject({
      kind: "refillHand",
      command: { command: "refillHand", version: 1, args: {} },
    });
    expect(refill.metadata.actionId).not.toBe(seen[0]!.metadata.actionId);
    expect(Object.isFrozen(refill.metadata)).toBe(true);
  });

  it("records nothing for a full hand or outside a stage, and keeps returning no cards", () => {
    const run = fresh();
    const seen = recording(run);
    expect(run.refillHand()).toEqual([]);
    run.forceOutcome("won");
    const terminal = seen.length;
    expect(run.refillHand()).toEqual([]);
    expect(seen.length).toBe(terminal);
    expect(commands(seen)).not.toContain("refillHand");
  });

  it("keeps the live order of rapid plays and refills, and a journal replays it exactly", () => {
    const original = fresh();
    const seen = recording(original);
    original.play({ cardId: original.state.hand[0]!.id });
    original.discard([original.state.hand[0]!.id]);
    expect(original.refillHand()).toHaveLength(2);
    original.discard([original.state.hand[0]!.id]);
    expect(original.refillHand()).toHaveLength(1);
    expect(commands(seen)).toEqual(["play", "discard", "refillHand", "discard", "refillHand"]);
    const replica = fresh();
    const replayed = recording(replica);
    for (const { metadata } of seen)
      expect(executeCommand(replica, metadata.command as never)).toBe(true);
    // Primitive play and discard never refill: each refill happens once, at its recorded place.
    expect(commands(replayed)).toEqual(commands(seen));
    expect(replica.state.hand.map(({ id }) => id)).toEqual(original.state.hand.map(({ id }) => id));
    expect(replica.state.deck.map(({ id }) => id)).toEqual(original.state.deck.map(({ id }) => id));
  });

  it("rolls a failed refill back, publishing nothing", () => {
    const run = fresh();
    run.play({ cardId: run.state.hand[0]!.id });
    const seen = recording(run);
    const before = run.state;
    const owner = run as unknown as { activeDealer: { refillHand(state: unknown): unknown } };
    const dealer = owner.activeDealer;
    owner.activeDealer = {
      ...dealer,
      refillHand: () => {
        throw new Error("deck jammed");
      },
    };
    expect(run.refillHand()).toEqual([]);
    expect(run.state).toBe(before);
    expect(seen).toEqual([]);
    expect(run.actionFailure?.message).toBe("deck jammed");
    owner.activeDealer = dealer;
  });

  it("setup replay keeps its explicit play-then-refill composite, refilling exactly once", () => {
    const run = fresh();
    const seen = recording(run);
    const size = run.state.hand.length;
    expect(scenarioReplayCommands.get("play")(run, { cardId: run.state.hand[0]!.id })).toBe(true);
    expect(run.state.hand).toHaveLength(size);
    expect(commands(seen)).toEqual(["play", "refillHand"]);
  });

  it("takes no arguments", () => {
    expect(describeCommand("refillHand", {})).toEqual({
      command: "refillHand",
      version: 1,
      args: {},
    });
    expect(() => describeCommand("refillHand", { count: 2 })).toThrow("no arguments");
  });
});
