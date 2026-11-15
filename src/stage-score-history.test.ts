import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { fromSaveRecord, toSaveRecord } from "./save";
import { demoRunRules } from "./run-rules";
import {
  appendStagePlay,
  legacyStageHistory,
  parseStageHistory,
  startStageHistory,
} from "./stage-score-history";

const fresh = () => new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0);
const reload = (run: GameRun) =>
  fromSaveRecord(
    JSON.parse(JSON.stringify(toSaveRecord(run.snapshot()))),
    standardDeck,
    dealerRegistry,
  );

describe("stage score history (#1063; doc/line-goes-up.md)", () => {
  it("starts each stage at (0, 0) with its configured allowance and target", () => {
    const run = fresh();
    const { history, targetScore } = run.state.round;
    expect(history).toMatchObject({
      plays: demoRunRules.stage(1, "stage-1").plays,
      targetScore,
      start: { play: 0, total: 0 },
      complete: true,
      entries: [],
    });
  });

  it("appends exactly one entry per committed play, and nothing for a discard", () => {
    const run = fresh();
    run.play({ cardId: run.state.hand[0].id }, "a1");
    run.refillHand();
    run.discard(run.state.hand[0].id, "d1");
    run.refillHand();
    const { history, score } = run.state.round;
    expect(history!.entries).toHaveLength(1);
    expect(history!.entries[0]).toMatchObject({ actionId: "a1", play: 1, total: score });
  });

  it("exports the appended point with the committed scoring fact", () => {
    const run = fresh();
    const facts: { type: string; payload: unknown }[] = [];
    run.onCommitted((published) => facts.push(...published));
    run.play({ cardId: run.state.hand[0].id }, "a1");
    const applied = facts.find(({ type }) => type === "score.totalApplied");
    const { generation, entries, plays, targetScore } = run.state.round.history!;
    expect((applied!.payload as { stageHistory?: unknown }).stageHistory).toEqual({
      generation,
      plays,
      targetScore,
      play: 1,
      delta: entries[0].delta,
      total: entries[0].total,
    });
  });

  it("advances the generation when the run moves to its next stage", () => {
    const run = fresh();
    const first = run.state.round.history!.generation;
    run.forceOutcome("won");
    run.advance();
    run.leaveShop();
    const next = run.state.round.history;
    expect(run.inStage).toBe(true);
    expect(next!.generation).toBe(first + 1);
  });

  it("records a zero-point play and never appends the same action twice", () => {
    const start = startStageHistory({ plays: 4, targetScore: 100 });
    const once = appendStagePlay(start, { actionId: "x", delta: 0 });
    expect(once.entries).toEqual([{ actionId: "x", play: 1, delta: 0, total: 0 }]);
    expect(appendStagePlay(once, { actionId: "x", delta: 0 })).toBe(once);
  });

  it("is replaced when the next stage starts", () => {
    const start = startStageHistory({ plays: 4, targetScore: 100 });
    const next = startStageHistory({ plays: 5, targetScore: 200 }, start);
    expect(next.generation).not.toBe(start.generation);
    expect(next).toMatchObject({ plays: 5, targetScore: 200, entries: [] });
  });

  it("survives a save and reload without replay", () => {
    const run = fresh();
    run.play({ cardId: run.state.hand[0].id }, "a1");
    const snapshot = reload(run)!;
    expect(snapshot.state.round.history).toEqual(run.state.round.history);
    const resumed = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, snapshot);
    expect(resumed.state.round.history).toEqual(run.state.round.history);
  });

  it("fails a save whose history is inconsistent", () => {
    const run = fresh();
    run.play({ cardId: run.state.hand[0].id }, "a1");
    const record = JSON.parse(JSON.stringify(toSaveRecord(run.snapshot())));
    record.state.round.history.entries[0].total += 1;
    expect(fromSaveRecord(record, standardDeck, dealerRegistry)).toBeNull();
    expect(
      parseStageHistory({ ...run.state.round.history, entries: [{ actionId: "a", play: 2 }] }),
    ).toBeNull();
  });

  it("rejects a history whose cumulative total overflows to infinity (#1175)", () => {
    const history = {
      ...startStageHistory({ plays: 4, targetScore: 1 }),
      start: { play: 0, total: Number.MAX_VALUE },
      entries: [{ actionId: "a", play: 1, delta: Number.MAX_VALUE, total: Infinity }],
    };
    expect(parseStageHistory(history)).toBeNull();
  });

  it("migrates a legacy save to a known checkpoint, without inventing earlier points", () => {
    const run = fresh();
    run.play({ cardId: run.state.hand[0].id }, "a1");
    const record = JSON.parse(JSON.stringify(toSaveRecord(run.snapshot())));
    delete record.state.round.history;
    const snapshot = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    const resumed = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, snapshot);
    const { history, score } = resumed.state.round;
    expect(history).toMatchObject({ start: { play: 1, total: score }, entries: [] });
    expect(history!.complete).toBe(false);
    // The score itself is untouched.
    expect(score).toBe(run.state.round.score);
    expect(legacyStageHistory({ score: 0, targetScore: 1, movesLeft: 3 }, null)).toBeNull();
  });
});
