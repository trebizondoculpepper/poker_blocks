import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { demoRunRules } from "./run-rules";
import {
  commandCodecs,
  describeCommand,
  executeCommand,
  type CommittedMetadata,
} from "./command-codecs";
import type { EventEnvelope } from "./lifecycle/action";

const fresh = () => new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0);

function recording(run: GameRun) {
  const seen: { facts: readonly EventEnvelope[]; metadata: CommittedMetadata }[] = [];
  run.onCommitted((facts, metadata) => seen.push({ facts, metadata }));
  return seen;
}

describe("committed command metadata (#1243; doc/experiments/command-journal.md)", () => {
  it("publishes a successful play's canonical descriptor with its facts", () => {
    const run = fresh();
    const seen = recording(run);
    const cardId = run.state.hand[0]!.id;
    run.play({ cardId }, "p1");
    expect(seen).toHaveLength(1);
    const { metadata, facts } = seen[0]!;
    expect(metadata.actionId).toBe("p1");
    expect(metadata.kind).toBe("play");
    expect(metadata.command).toEqual({ command: "play", version: 1, args: { cardId } });
    expect(metadata.context.round).toBe(1);
    // The facts and metadata are the same action's.
    expect(facts.every(({ actionId }) => actionId === "p1")).toBe(true);
    expect(Object.isFrozen(metadata)).toBe(true);
  });

  it("captures the arguments as called, so a later mutation by the caller can't change them", () => {
    const run = fresh();
    const seen = recording(run);
    const ids = [run.state.hand[0]!.id];
    run.discard(ids, "d1");
    ids.push("tampered");
    const command = seen[0]!.metadata.command as { args: { cardIds: string[] } };
    expect(command.args.cardIds).toEqual([ids[0]]);
    expect(Object.isFrozen(command.args.cardIds)).toBe(true);
  });

  it("publishes nothing for a refused, duplicate or invalid command", () => {
    const run = fresh();
    const seen = recording(run);
    // Refused: no such card.
    expect(run.play({ cardId: "no-such-card" }, "x1")).toBeNull();
    run.play({ cardId: run.state.hand[0]!.id }, "dup");
    // Duplicate submission of an ID already committed.
    run.play({ cardId: run.state.hand[0]!.id }, "dup");
    expect(seen.map(({ metadata }) => metadata.actionId)).toEqual(["dup"]);
  });

  it("marks an action committed without a codec as unavailable, never silently omitting it", () => {
    const run = fresh();
    const seen = recording(run);
    run.forceOutcome("won");
    run.advance();
    const unavailable = seen
      .map(({ metadata }) => metadata.command)
      .filter((command) => "unavailable" in command);
    expect(unavailable.length).toBeGreaterThan(0);
    expect(unavailable[0]).toEqual({ unavailable: expect.stringContaining("no command codec") });
  });

  it("carries the context the action resolved in, deeply frozen (#1243 review)", () => {
    const run = fresh();
    const seen = recording(run);
    const before = run.stageContext;
    run.forceOutcome("won");
    run.advance();
    // The advance commits in the old stage and moves on: its metadata keeps the old stage.
    const advanced = seen.at(-1)!.metadata;
    expect(advanced.context.stage).toEqual(before);
    expect(Object.isFrozen(advanced.context)).toBe(true);
    if (advanced.context.stage) expect(Object.isFrozen(advanced.context.stage)).toBe(true);
    const play = fresh();
    const plays = recording(play);
    play.play({ cardId: play.state.hand[0]!.id }, "p1");
    const command = plays[0]!.metadata.command as { args: object };
    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(command.args)).toBe(true);
  });

  it("keeps one-argument listeners working", () => {
    const run = fresh();
    const facts: number[] = [];
    run.onCommitted((published) => facts.push(published.length));
    run.play({ cardId: run.state.hand[0]!.id });
    expect(facts).toHaveLength(1);
  });
});

describe("primitive command executors (#1243)", () => {
  it("replays a recorded descriptor through the ordinary model command, without refilling", () => {
    const original = fresh();
    const seen = recording(original);
    original.play({ cardId: original.state.hand[0]!.id }, "p1");
    const replica = fresh();
    expect(executeCommand(replica, seen[0]!.metadata.command as never)).toBe(true);
    expect(replica.state.round.score).toBe(original.state.round.score);
    expect(replica.state.field).toHaveLength(1);
    // Primitive: the played card is not replaced in the hand.
    expect(replica.state.hand.length).toBe(original.state.hand.length);
  });

  it("normalizes an empty play group to a single-card play, as the model does (#1276)", () => {
    const run = fresh();
    const seen = recording(run);
    const cardId = run.state.hand[0]!.id;
    run.play({ cardId, cardIds: [] }, "p1");
    expect(seen[0]!.metadata.command).toEqual({ command: "play", version: 1, args: { cardId } });
  });

  it("validates arguments and versions", () => {
    expect(() => describeCommand("play", { cardId: 3 })).toThrow("play cardId");
    expect(() => describeCommand("discard", { cardIds: [] })).toThrow("discard cardIds");
    expect(() =>
      executeCommand(fresh(), { command: "play", version: 99, args: { cardId: "x" } }),
    ).toThrow("v99");
    expect(commandCodecs.has("play") && commandCodecs.has("discard")).toBe(true);
  });
});
