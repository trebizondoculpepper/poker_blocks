import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { describeCommand, executeCommand, type CommittedMetadata } from "./command-codecs";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import type { EventEnvelope } from "./lifecycle/action";
import { materialOf } from "./materials";
import { demoRunRules } from "./run-rules";
import { createTransmogrifier } from "./transmogrifiers";

/** A run whose rack holds these items, as a restored run would. */
const withRack = (...items: ReturnType<typeof createTransmogrifier>[]) => {
  const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
  return GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, {
    ...game.snapshot(),
    state: { ...game.state, passiveRack: items },
  });
};

function recording(run: GameRun) {
  const seen: { facts: readonly EventEnvelope[]; metadata: CommittedMetadata }[] = [];
  run.onCommitted((facts, metadata) => seen.push({ facts, metadata }));
  return seen;
}

describe("rack-item use as a journalled command (#1246; doc/experiments/command-journal.md)", () => {
  it("publishes each committed use's canonical descriptor with exactly its own facts", () => {
    const run = withRack(
      createTransmogrifier("steel", "t1", 8),
      createTransmogrifier("wood", "t2", 6),
    );
    const seen = recording(run);
    const [first, second] = run.state.hand;
    expect(run.applyRackItem("t1", first!.id)).not.toBeNull();
    expect(run.applyRackItem("t2", second!.id)).not.toBeNull();
    expect(seen.map(({ metadata }) => metadata.command)).toEqual([
      { command: "applyRackItem", version: 1, args: { itemId: "t1", cardId: first!.id } },
      { command: "applyRackItem", version: 1, args: { itemId: "t2", cardId: second!.id } },
    ]);
    for (const { facts, metadata } of seen) {
      expect(metadata.kind).toBe("useItem");
      expect(facts.length).toBeGreaterThan(0);
      expect(facts.every(({ actionId }) => actionId === metadata.actionId)).toBe(true);
      expect(Object.isFrozen((metadata.command as { args: object }).args)).toBe(true);
    }
    // Independent uses are independent actions.
    expect(seen[0]!.metadata.actionId).not.toBe(seen[1]!.metadata.actionId);
    // Use consumption and the material effect are unchanged.
    expect(materialOf(run.state.hand[0]!)).toBe("steel");
    expect(run.state.passiveRack[0]!.traits.limitedUse).toEqual({ uses: 1, total: 2 });
  });

  it("publishes nothing for a refused use: an invalid target or an unknown item", () => {
    const run = withRack(createTransmogrifier("steel", "t1", 8));
    const seen = recording(run);
    const before = run.state;
    expect(run.applyRackItem("t1", "no-such-card")).toBeNull();
    expect(run.applyRackItem("no-such-item", run.state.hand[0]!.id)).toBeNull();
    const card = run.state.hand[0]!.id;
    run.applyRackItem("t1", card);
    // Already steel: refused, nothing spent, nothing published.
    expect(run.applyRackItem("t1", card)).toBeNull();
    expect(seen).toHaveLength(1);
    expect(before.passiveRack[0]!.traits.limitedUse?.uses).toBe(2);
  });

  it("replays a recorded use through the ordinary model command", () => {
    const original = withRack(createTransmogrifier("steel", "t1", 8));
    const seen = recording(original);
    original.applyRackItem("t1", original.state.hand[2]!.id);
    const replica = withRack(createTransmogrifier("steel", "t1", 8));
    const replayed = recording(replica);
    expect(executeCommand(replica, seen[0]!.metadata.command as never)).toBe(true);
    expect(materialOf(replica.state.hand[2]!)).toBe("steel");
    expect(JSON.stringify(replica.state.passiveRack)).toBe(
      JSON.stringify(original.state.passiveRack),
    );
    expect(replayed[0]!.facts.map(({ type }) => type)).toEqual(
      seen[0]!.facts.map(({ type }) => type),
    );
    // A refused replay reports it did not commit.
    expect(executeCommand(replica, seen[0]!.metadata.command as never)).toBe(false);
  });

  it("validates its arguments", () => {
    expect(() => describeCommand("applyRackItem", { itemId: "t1" })).toThrow(
      "applyRackItem cardId",
    );
    expect(() => describeCommand("applyRackItem", { itemId: 3, cardId: "c" })).toThrow(
      "applyRackItem itemId",
    );
  });
});
