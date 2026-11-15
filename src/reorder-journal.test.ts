import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { describeCommand, executeCommand, type CommittedMetadata } from "./command-codecs";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import type { EventEnvelope } from "./lifecycle/action";
import { passiveTraits, type PassiveBlock } from "./passives";
import { demoRunRules, sandboxRunRules } from "./run-rules";
import { inspectable } from "./traits/inspectable";

const session = () =>
  new GameRun(dealerRegistry, sandboxRunRules(demoRunRules), standardDeck, () => 0);

function recording(run: GameRun) {
  const seen: { facts: readonly EventEnvelope[]; metadata: CommittedMetadata }[] = [];
  run.onCommitted((facts, metadata) => seen.push({ facts, metadata }));
  return seen;
}

/** Passives that record the order they respond in, by their own instance id. */
const heard: string[] = [];
passiveTraits.register("test.journal.listener", {
  id: "test.journal.listener",
  listensTo: ["discard.completed"],
  respond: (passive) => {
    heard.push(passive.id);
    return [];
  },
});
const listener = (id: string): PassiveBlock => ({
  id,
  definitionId: "double-line",
  traits: {
    rackResident: { zone: "passive-rack" },
    passive: { traitId: "test.journal.listener" },
    inspectable: inspectable(id),
  },
});
const withListeners = () => {
  const run = session();
  run.installPassive(listener("left"));
  run.installPassive(listener("right"));
  return run;
};

describe("hand and rack reorders as journalled commands (#1245; doc/experiments/command-journal.md)", () => {
  it("publishes a real hand move's descriptor with an empty fact array", () => {
    const run = session();
    const seen = recording(run);
    const before = run.state.hand;
    expect(run.reorderHand(0, 2)).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.facts).toEqual([]);
    expect(seen[0]!.metadata).toMatchObject({
      kind: "reorderHand",
      command: { command: "reorderHand", version: 1, args: { from: 0, to: 2 } },
    });
    expect(Object.isFrozen((seen[0]!.metadata.command as { args: object }).args)).toBe(true);
    // Unchanged behaviour: only the hand's order moved.
    expect(run.state.hand).toEqual([before[1], before[2], before[0], ...before.slice(3)]);
  });

  it("records nothing for a true no-op or a refused move, and keeps their return values", () => {
    const run = session();
    const seen = recording(run);
    const before = run.state;
    expect(run.reorderHand(1, 1)).toBe(true);
    expect(run.reorderHand(0, 99)).toBe(false);
    expect(run.reorderPassive(0, 0)).toBe(false);
    expect(run.state).toBe(before);
    expect(seen).toEqual([]);
  });

  it("publishes a rack move; replayed, later responses follow the same order", () => {
    heard.length = 0;
    const original = withListeners();
    const seen = recording(original);
    expect(original.reorderPassive(1, 0)).toBe(true);
    original.discard(original.state.hand[0]!.id);
    const originalOrder = [...heard];
    expect(originalOrder).toEqual(["right", "left"]);
    expect(seen[0]!.facts).toEqual([]);
    expect(seen[0]!.metadata.command).toEqual({
      command: "reorderPassive",
      version: 1,
      args: { from: 1, to: 0 },
    });
    heard.length = 0;
    const replica = withListeners();
    for (const { metadata } of seen)
      expect(executeCommand(replica, metadata.command as never)).toBe(true);
    expect(heard).toEqual(originalOrder);
    expect(replica.state.passiveRack.map(({ id }) => id)).toEqual(["right", "left"]);
  });

  it("rolls a failed rack move back with nothing published", () => {
    const run = withListeners();
    const seen = recording(run);
    const rack = run.state.passiveRack;
    // A rack that can't take the new order: the sync throws inside the transaction.
    const events = (run as unknown as { passiveEvents: { syncRack(rack: unknown): void } })
      .passiveEvents;
    const sync = events.syncRack.bind(events);
    let fail = true;
    events.syncRack = (next) => {
      if (fail) {
        fail = false;
        throw new Error("sync failed");
      }
      sync(next);
    };
    expect(run.reorderPassive(1, 0)).toBe(false);
    expect(run.state.passiveRack).toBe(rack);
    expect(seen).toEqual([]);
    expect(run.actionFailure?.message).toBe("sync failed");
  });

  it("validates positions", () => {
    expect(() => describeCommand("reorderHand", { from: -1, to: 0 })).toThrow("reorderHand from");
    expect(() => describeCommand("reorderPassive", { from: 0, to: 1.5 })).toThrow(
      "reorderPassive to",
    );
  });
});
