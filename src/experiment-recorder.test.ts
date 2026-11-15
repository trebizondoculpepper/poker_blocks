import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { Registry } from "./core/registry";
import { baseDealer, type Dealer } from "./dealer";
import {
  createExperimentRecorder,
  experimentRecordFormat,
  readExperimentRecord,
  type StartingProvenance,
} from "./experiment-recorder";
import { GameRun } from "./game-run";
import type { RunRules } from "./run-rules";

/** A real run, with a counted random stream so a test can tell whether recording drew from it. */
function makeRun(targetScore = 10) {
  const dealers = new Registry<Dealer>("dealer");
  dealers.register(baseDealer.name, baseDealer);
  const rules: RunRules = {
    stage: () => ({ dealer: "base", targetScore, plays: 3, discards: 2 }),
    handAtStageEnd: "return-to-deck",
    discardPileAfterShop: "keep-out",
  };
  let draws = 0;
  const run = new GameRun(dealers, rules, standardDeck, () => {
    draws++;
    return 0;
  });
  const source = {
    onCommitted: run.onCommitted.bind(run),
    committedState: () => run.state,
    lastScoring: () => ({ field: run.lastScoringField, lines: run.lastScoredLines }),
  };
  return { run, source, draws: () => draws };
}

/** A run with a recorder over it, given the recorder's options. */
const trial = (options: Parameters<typeof createExperimentRecorder>[1]) => {
  const { run, source } = makeRun();
  return { run, recorder: createExperimentRecorder(source, options) };
};

/** Play the first `count` hand cards as one line. */
const playLine = (run: GameRun, count = 5) => {
  const ids = run.state.hand.slice(0, count).map(({ id }) => id);
  return run.play({ cardId: ids[0]!, cardIds: ids });
};

describe("the experiment trial recorder (#935)", () => {
  it("records each committed action in order, with what it awarded and its measurements", () => {
    const { run, source } = makeRun(10_000);
    const recorder = createExperimentRecorder(source);
    const before = run.state.round.score;
    expect(playLine(run)).not.toBeNull();
    run.discard(run.state.hand[0]!.id);
    const record = recorder.record();
    expect(record.format).toBe(experimentRecordFormat);
    expect(record.initial).toEqual({ score: before, field: 0 });
    expect(record.actions.map(({ index }) => index)).toEqual([0, 1]);
    const [play, discard] = record.actions;
    expect(play!.awarded).toBe(run.state.round.score - before);
    expect(play!.awarded).toBeGreaterThan(0);
    expect(play!.score).toBe(run.state.round.score);
    expect(play!.metrics.scored.length).toBeGreaterThan(0);
    expect(play!.facts.map(({ type }) => type)).toContain("score.totalApplied");
    expect(new Set(play!.facts.map(({ sequence }) => sequence)).size).toBe(play!.facts.length);
    // A discard scores nothing: no awarded points and no scored rows of an older play.
    expect(discard!.awarded).toBe(0);
    expect(discard!.metrics.scored).toEqual([]);
    expect(discard!.facts.map(({ type }) => type)).toContain("discard.completed");
    expect(record.outcome).toBeNull();
  });

  it("records nothing for an invalid action", () => {
    const { run, source } = makeRun();
    const recorder = createExperimentRecorder(source);
    expect(run.discard("no-such-card")).toBeNull();
    expect(recorder.record().actions).toEqual([]);
  });

  it("records the first decided outcome, with the action that decided it", () => {
    const { run, source } = makeRun(1);
    const recorder = createExperimentRecorder(source);
    playLine(run);
    const record = recorder.record();
    expect(record.outcome).toMatchObject({ result: "won", score: run.state.round.score });
    expect(record.outcome!.actionId).toBe(record.actions[0]!.actionId);
  });

  it("keeps counterfactual scores labelled and apart from the awarded points", () => {
    const { run, source } = makeRun(10_000);
    const recorder = createExperimentRecorder(source, {
      counterfactuals: [
        ({ lines }) => ({ label: "Neutral baseline", score: lines.length * 1000 }),
        () => null,
      ],
    });
    const before = run.state.round.score;
    playLine(run);
    run.discard(run.state.hand[0]!.id);
    const [play, discard] = recorder.record().actions;
    expect(play!.counterfactuals).toEqual([
      { label: "Neutral baseline", score: play!.metrics.scored.length * 1000 },
    ]);
    expect(play!.awarded).toBe(run.state.round.score - before);
    expect(discard!.counterfactuals).toEqual([]);
  });

  it("logs parameter changes in order with the actions", () => {
    const { run, source } = makeRun(10_000);
    const recorder = createExperimentRecorder(source);
    recorder.parameterChanged({ trial: "t1", settings: { threshold: 0.5 } });
    playLine(run);
    recorder.parameterChanged({ trial: "t2", settings: { threshold: 0.7 } });
    expect(recorder.record().parameterChanges).toEqual([
      { afterActions: 0, change: { trial: "t1", settings: { threshold: 0.5 } } },
      { afterActions: 1, change: { trial: "t2", settings: { threshold: 0.7 } } },
    ]);
  });

  it("returns independent plain copies that later play can't change", () => {
    const { run, source } = makeRun(10_000);
    const recorder = createExperimentRecorder(source);
    playLine(run);
    const first = recorder.record();
    first.actions[0]!.awarded = -1;
    run.discard(run.state.hand[0]!.id);
    const second = recorder.record();
    expect(second.actions[0]!.awarded).toBeGreaterThan(0);
    expect(first.actions).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(second))).toEqual(second);
  });

  it("stops listening on dispose, and begins empty on a run that already has history", () => {
    const { run, source } = makeRun(10_000);
    playLine(run);
    run.refillHand();
    const recorder = createExperimentRecorder(source);
    expect(recorder.record().actions).toEqual([]);
    expect(recorder.record().initial.field).toBe(run.state.field.length);
    run.discard(run.state.hand[0]!.id);
    recorder.dispose();
    run.discard(run.state.hand[0]!.id);
    recorder.parameterChanged({ late: true });
    const record = recorder.record();
    expect(record.actions).toHaveLength(1);
    expect(record.parameterChanges).toEqual([]);
  });

  it("draws no randomness: the same actions draw the same with or without it", () => {
    const plain = makeRun(10_000);
    playLine(plain.run);
    plain.run.discard(plain.run.state.hand[0]!.id);
    const recorded = makeRun(10_000);
    createExperimentRecorder(recorded.source, {
      counterfactuals: [({ lines }) => ({ label: "x", score: lines.length })],
    });
    playLine(recorded.run);
    recorded.run.discard(recorded.run.state.hand[0]!.id);
    expect(recorded.draws()).toBe(plain.draws());
    expect(recorded.run.state).toEqual(plain.run.state);
  });
});

describe("version-2 records: committed commands and starting provenance (#1247)", () => {
  const provenance = (): StartingProvenance => ({
    configuration: { format: "poker-blocks.experiment-config", version: 1 },
    snapshot: { round: 1 },
    ids: { c1: "card-1" },
    checkpoint: { state: 42, draws: 3 },
    setup: [{ command: "play", version: 1, args: { cardId: "c1" } }],
  });

  it("records each committed command, and a refill or reorder as its own step with nothing scored", () => {
    const { run, recorder } = trial({ start: provenance });
    run.play({ cardId: run.state.hand[0]!.id });
    run.refillHand();
    run.reorderHand(0, 2);
    const { actions, version } = recorder.record();
    expect(version).toBe(2);
    expect(
      actions.map(({ kind, command }) => [kind, (command as { command: string }).command]),
    ).toEqual([
      ["play", "play"],
      ["refillHand", "refillHand"],
      ["reorderHand", "reorderHand"],
    ]);
    for (const step of actions.slice(1)) {
      expect(step.facts).toEqual([]);
      expect(step.awarded).toBe(0);
      expect(step.counterfactuals).toEqual([]);
      // No stale rows: an earlier play's scoring never shows as this step's.
      expect(step.metrics.scored).toEqual([]);
    }
    expect(new Set(actions.map(({ actionId }) => actionId)).size).toBe(3);
  });

  it("captures the installer's starting provenance once, and is replayable when all is complete", () => {
    let calls = 0;
    const { run, recorder } = trial({ start: () => (calls++, provenance()) });
    run.play({ cardId: run.state.hand[0]!.id });
    const record = recorder.record();
    expect(calls).toBe(1);
    expect(record.start).toEqual(provenance());
    expect(record.completeness).toEqual({
      start: { complete: true },
      commands: { complete: true },
    });
    expect(readExperimentRecord(record)).toMatchObject({ ok: true, version: 2, replayable: true });
  });

  it("never substitutes a start it wasn't given: missing or invalid provenance is unavailable", () => {
    const none = trial({}).recorder.record();
    expect(none.start).toEqual({ unavailable: expect.stringContaining("no starting provenance") });
    expect(none.completeness.start.complete).toBe(false);
    const midSession = trial({
      start: () => ({ unavailable: "installed mid-session" }),
    }).recorder.record();
    expect(midSession.start).toEqual({ unavailable: "installed mid-session" });
    const broken = trial({
      start: () => ({ ...provenance(), checkpoint: { state: Number.NaN, draws: 0 } }),
    }).recorder.record();
    expect(broken.start).toEqual({ unavailable: expect.stringContaining("checkpoint") });
    const read = readExperimentRecord(none);
    expect(read).toMatchObject({ ok: true, replayable: false });
    expect((read as { diagnostics: string[] }).diagnostics[0]).toContain("start unavailable");
  });

  it("marks its commands incomplete from the first step without a codec", () => {
    const { run, recorder } = trial({ start: provenance });
    run.play({ cardId: run.state.hand[0]!.id });
    // Leaving a won stage commits an action no codec describes yet.
    run.forceOutcome("won");
    run.advance();
    const record = recorder.record();
    const from = record.actions.findIndex(({ command }) => "unavailable" in command);
    expect(from).toBeGreaterThan(0);
    expect(record.completeness.commands).toEqual({
      complete: false,
      from,
      reason: expect.stringContaining("no command codec"),
    });
    expect(readExperimentRecord(record)).toMatchObject({ replayable: false });
  });

  it("keeps a version-1 record inspectable, never replayable", () => {
    const legacy = { format: "poker-blocks.experiment-record", version: 1, actions: [] };
    expect(readExperimentRecord(legacy)).toMatchObject({
      ok: true,
      version: 1,
      replayable: false,
      diagnostics: [expect.stringContaining("facts, not commands")],
    });
    expect(readExperimentRecord({ format: "other" })).toEqual({
      ok: false,
      diagnostic: "not an experiment record",
    });
    expect(
      readExperimentRecord({ format: "poker-blocks.experiment-record", version: 9 }),
    ).toMatchObject({
      ok: false,
    });
  });

  it("records the model's random checkpoint with each step when one is configured", () => {
    const { run, recorder } = trial({ start: provenance });
    let draws = 0;
    run.attachRandomCheckpoints({
      checkpoint: () => ({ state: 7, draws: ++draws }),
      restore: () => {},
    } as never);
    run.play({ cardId: run.state.hand[0]!.id });
    expect(recorder.record().actions[0]!.checkpoint).toEqual({
      state: 7,
      draws: expect.any(Number),
    });
  });

  it("refuses provenance without its configuration artifact or starting snapshot (#1318 review)", () => {
    const missing = trial({
      start: () => ({ ...provenance(), configuration: undefined, snapshot: undefined }) as never,
    }).recorder.record();
    expect(missing.start).toEqual({ unavailable: expect.stringContaining("configuration") });
    const noSnapshot = trial({
      start: () => ({ ...provenance(), snapshot: null }),
    }).recorder.record();
    expect(noSnapshot.start).toEqual({ unavailable: expect.stringContaining("snapshot") });
  });

  it("offers an imported record for replay only when its contents agree with its flags", () => {
    const hollow = {
      format: "poker-blocks.experiment-record",
      version: 2,
      completeness: { start: { complete: true }, commands: { complete: true } },
    };
    const read = readExperimentRecord(hollow);
    expect(read).toMatchObject({ ok: true, replayable: false });
    expect((read as { diagnostics: string[] }).diagnostics).toEqual(
      expect.arrayContaining([expect.stringContaining("no usable starting provenance")]),
    );
    const { run, recorder } = trial({ start: provenance });
    run.play({ cardId: run.state.hand[0]!.id });
    const stale = recorder.record();
    stale.actions[0]!.command = { unavailable: "edited" };
    expect(readExperimentRecord(stale)).toMatchObject({ replayable: false });
    expect(readExperimentRecord(recorder.record())).toMatchObject({ replayable: true });
  });
});
