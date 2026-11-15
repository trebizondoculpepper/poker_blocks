import { describe, expect, it } from "vite-plus/test";
import type { CommittedMetadata } from "./command-codecs";
import type { EventEnvelope } from "./lifecycle/action";
import { createPlacementPhase, placementProducer, scoringProducer } from "./placement-phase";
import {
  createScoreGraphController,
  graphProducer,
  type GraphSeries,
} from "./score-graph-controller";
import { createActionPhases, createCompletionAdapter } from "./visual-events/action-phases";
import { createVisualScheduler, unitMs } from "./visual-events/scheduler";

function harness() {
  const scheduler = createVisualScheduler();
  let now = 0;
  scheduler.update(0, true);
  const step = (ms: number) => {
    for (let t = 0; t < ms; t += 10) scheduler.update((now += 10), true);
  };
  const listeners = new Set<
    (facts: readonly EventEnvelope[], metadata: CommittedMetadata) => void
  >();
  const source = {
    onCommitted(listener: (facts: readonly EventEnvelope[], metadata: CommittedMetadata) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const phases = createActionPhases(scheduler, {
    plan: "scoring",
    producers: [placementProducer, scoringProducer, graphProducer],
  });
  const phase = createPlacementPhase(source, phases);
  const drawn: GraphSeries[] = [];
  const graph = createScoreGraphController({
    source,
    phase,
    sink: { draw: (s) => void drawn.push(s) },
  });
  /** The model commits a scoring play: its captured history point. */
  const commit = (actionId: string, play: number, total: number, generation = 1) => {
    const facts = [
      {
        type: "score.totalApplied",
        payload: { amount: 0, stageHistory: { generation, play, delta: 0, total } },
      },
    ] as unknown as EventEnvelope[];
    for (const listener of listeners) listener(facts, { actionId } as CommittedMetadata);
    return phase.latest!;
  };
  /** That play's narration finished: its scoring contribution completes. */
  const scored = (key: ReturnType<typeof commit>) => {
    const completion = createCompletionAdapter();
    phase.contributionFor(key, scoringProducer)!.bind(completion.work);
    completion.done();
  };
  /** A scoring commit that carries no captured stage-history point. */
  const commitBare = (actionId: string) => {
    const facts = [
      { type: "score.totalApplied", payload: { amount: 0 } },
    ] as unknown as EventEnvelope[];
    for (const listener of listeners) listener(facts, { actionId } as CommittedMetadata);
    return phase.latest!;
  };
  return { graph, drawn, commit, commitBare, scored, step, phases, phase };
}

describe("committed-score graph controller (#1087; doc/line-goes-up.md)", () => {
  it("draws the captured history at once on entry, without replaying growth", () => {
    const { graph, drawn } = harness();
    graph.show({
      generation: 1,
      plays: 4,
      targetScore: 100,
      start: { play: 0, total: 0 },
      complete: true,
      entries: [{ actionId: "a", play: 1, delta: 30, total: 30 }],
    });
    expect(drawn).toEqual([
      {
        plays: 4,
        targetScore: 100,
        points: [
          { play: 0, total: 0 },
          { play: 1, total: 30 },
        ],
        growth: 1,
      },
    ]);
  });

  it("grows the new point only after that play's scoring completes, over 4 units", () => {
    const { drawn, commit, scored, step } = harness();
    const key = commit("p1", 1, 40);
    step(200);
    // Scoring not yet complete: nothing grows.
    expect(drawn).toEqual([]);
    scored(key);
    step(30);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn[0]!.growth).toBeLessThan(1);
    step(4 * unitMs + 50);
    expect(drawn.at(-1)!.growth).toBe(1);
    expect(drawn.at(-1)!.points.at(-1)).toEqual({ play: 1, total: 40 });
  });

  it("updates the plot in committed order, without waiting for later narration", () => {
    const { drawn, commit, scored, step } = harness();
    const first = commit("p1", 1, 10);
    const second = commit("p2", 2, 25);
    // The second play's scoring completes first; its growth still follows the first's.
    scored(second);
    step(100);
    expect(drawn.every(({ points }) => points.length < 3)).toBe(true);
    scored(first);
    step(4 * unitMs * 2 + 100);
    const lengths = drawn.map(({ points }) => points.length);
    expect(lengths.indexOf(3)).toBeGreaterThan(lengths.lastIndexOf(2));
  });

  it("starts a new stage's series, and an old stage's growth draws nothing more", () => {
    const { drawn, commit, scored, step } = harness();
    const old = commit("p1", 1, 10, 1);
    const fresh = commit("p2", 1, 5, 2);
    scored(old);
    scored(fresh);
    step(4 * unitMs * 2 + 100);
    expect(drawn.every(({ points }) => !points.some(({ total }) => total === 10))).toBe(true);
    expect(drawn.at(-1)!.points).toEqual([
      { play: 0, total: 0 },
      { play: 1, total: 5 },
    ]);
  });

  it("releases a growth whose reservation is cancelled before it starts (#1087 review)", async () => {
    const { pendingGrowths } = await import("./score-graph-controller");
    const { commit, phases } = harness();
    const before = pendingGrowths();
    const key = commit("p1", 1, 10);
    expect(pendingGrowths()).toBe(before + 1);
    expect(key).not.toBeNull();
    // A reset cancels the record (its scoring never completed): the growth record goes too.
    phases.reset();
    expect(pendingGrowths()).toBe(before);
  });

  it("never draws growth from before a restore over the restored history (#1087 review)", () => {
    const { graph, drawn, commit, scored, step } = harness();
    const key = commit("p1", 1, 40);
    graph.show({
      generation: 1,
      plays: 4,
      targetScore: 100,
      start: { play: 0, total: 0 },
      complete: true,
      entries: [],
    });
    const after = drawn.length;
    scored(key);
    step(4 * unitMs + 100);
    expect(drawn.length).toBe(after);
  });

  it("settles a reservation with no captured history point empty, so the outcome isn't held", () => {
    const { commitBare, phase, scored, step } = harness();
    const key = commitBare("bare");
    const reservation = phase.contributionFor(key, graphProducer)!;
    // Nothing is ever bound to it; once scoring completes it finishes empty, not at the bound.
    scored(key);
    step(200);
    expect(reservation.status()).toEqual({ state: "finished" });
  });
});
