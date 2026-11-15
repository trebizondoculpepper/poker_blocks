import { describe, expect, it } from "vite-plus/test";
import type { CommittedMetadata } from "./command-codecs";
import type { EventEnvelope } from "./lifecycle/action";
import { createPlacementPhase, factProducer, placementProducer } from "./placement-phase";
import { createActionPhases } from "./visual-events/action-phases";
import {
  createVisualScheduler,
  visualHandlers,
  type EffectHandle,
} from "./visual-events/scheduler";

const ran: string[] = [];
visualHandlers.register("test.flight", (payload, context): EffectHandle => {
  const { label, ms } = payload as { label: string; ms: number };
  const started = context.nowMs;
  ran.push(`${label}@start`);
  return {
    update: (now) => (now - started >= ms ? (ran.push(`${label}@end`), "finished") : "running"),
    cancel: () => void ran.push(`${label}@cancel`),
    dispose: () => {},
  };
});

/** A committed source that publishes what the test says, as the model would. */
function source() {
  const listeners = new Set<
    (facts: readonly EventEnvelope[], metadata: CommittedMetadata) => void
  >();
  return {
    onCommitted(listener: (facts: readonly EventEnvelope[], metadata: CommittedMetadata) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    commit(actionId: string, types: string[]) {
      const facts = types.map((type) => ({ type }) as EventEnvelope);
      const metadata = { actionId } as CommittedMetadata;
      for (const listener of listeners) listener(facts, metadata);
    },
  };
}

function harness() {
  ran.length = 0;
  const scheduler = createVisualScheduler();
  let now = 0;
  scheduler.update(0, true);
  const step = (ms: number) => {
    for (let t = 0; t < ms; t += 10) scheduler.update((now += 10), true);
  };
  const committed = source();
  const phases = createActionPhases(scheduler, { plan: "scoring", producers: [placementProducer] });
  const placement = createPlacementPhase(committed, phases);
  return { committed, placement, step };
}

const flight = (label: string, ms = 50) => ({
  handler: "test.flight",
  payload: { label, ms },
  dueUnits: 0,
});

describe("placement bound to committed action identities (#1219)", () => {
  it("reserves a placing action's pre-scoring at publication, keyed by the model's action ID", () => {
    const { committed, placement } = harness();
    committed.commit("run1:play#1", ["play.placed", "score.totalApplied"]);
    expect(placement.latest).toMatchObject({ actionId: "run1:play#1" });
    expect(placement.contribution()).not.toBeNull();
    expect(placement.preScoring(placement.latest!)).toEqual({ state: "pending" });
  });

  it("completes the action's pre-scoring once its bound flight lands", () => {
    const { committed, placement, step } = harness();
    committed.commit("p1", ["play.placed"]);
    const key = placement.latest!;
    expect(placement.contribution()!.bind(flight("f1"))).toBe(true);
    // Bound once: a second bind is refused.
    expect(placement.contribution()!.bind(flight("again"))).toBe(false);
    step(100);
    expect(ran).toEqual(["f1@start", "f1@end"]);
    expect(placement.preScoring(key)).toEqual({ state: "finished" });
  });

  it("gives an action that placed nothing an empty, already complete pre-scoring", () => {
    const { committed, placement, step } = harness();
    committed.commit("d1", ["discard.committed"]);
    expect(placement.contribution()).toBeNull();
    step(20);
    expect(placement.preScoring(placement.latest!)).toEqual({ state: "finished" });
  });

  it("keeps each action's flight its own when plays overlap", () => {
    const { committed, placement, step } = harness();
    committed.commit("p1", ["play.placed"]);
    const first = placement.latest!;
    placement.contribution()!.bind(flight("f1", 200));
    step(30);
    committed.commit("p2", ["play.placed"]);
    const second = placement.latest!;
    placement.contribution()!.bind(flight("f2", 50));
    step(100);
    // The later play finished first; the earlier is still flying.
    expect(placement.preScoring(second)).toEqual({ state: "finished" });
    expect(placement.preScoring(first)).toEqual({ state: "pending" });
    step(200);
    expect(placement.preScoring(first)).toEqual({ state: "finished" });
  });

  it("cancels bound flights once on reset; old actions become unavailable", () => {
    const { committed, placement, step } = harness();
    committed.commit("p1", ["play.placed"]);
    const key = placement.latest!;
    placement.contribution()!.bind(flight("f1", 500));
    step(30);
    placement.reset();
    step(30);
    expect(ran.filter((entry) => entry === "f1@cancel")).toHaveLength(1);
    expect(placement.preScoring(key)).toBe("unavailable");
    expect(placement.contribution()).toBeNull();
  });

  it("reserves by configured fact, not by what kind of action it is", () => {
    const producer = factProducer({ fact: "test.fact", slot: "scoring" });
    expect(producer.reserve({ factTypes: ["a", "test.fact"] })).toEqual({ slot: "scoring" });
    expect(producer.reserve({ factTypes: ["play.placed"] })).toBeNull();
  });
});

describe("scoring completion through the completion adapter (#1220)", () => {
  it("opens post-score after that action's scoring, and its root only after post-score", async () => {
    const { createCompletionAdapter, phaseProducers } =
      await import("./visual-events/action-phases");
    const { scoringProducer } = await import("./placement-phase");
    const graph = "test.graph.1220";
    phaseProducers.register(
      graph,
      factProducer({ fact: "score.totalApplied", slot: "postScoring" }),
    );
    ran.length = 0;
    const scheduler = createVisualScheduler();
    let now = 0;
    scheduler.update(0, true);
    const step = (ms: number) => {
      for (let t = 0; t < ms; t += 10) scheduler.update((now += 10), true);
    };
    const committed = source();
    const phases = createActionPhases(scheduler, {
      plan: "scoring",
      producers: [graph, placementProducer, scoringProducer],
    });
    const placement = createPlacementPhase(committed, phases);
    committed.commit("p1", ["play.placed", "score.totalApplied"]);
    const key = placement.latest!;
    let rootSettled = false;
    placement.observeAction(key, () => void (rootSettled = true));
    // The graph reserved and bound early; it can't start before scoring completes.
    placement.contributionFor(key, graph)!.bind(flight("graph", 20));
    placement.contribution()!.bind(flight("flight", 50));
    step(100);
    const completion = createCompletionAdapter();
    expect(placement.contributionFor(key, scoringProducer)!.bind(completion.work)).toBe(true);
    step(200);
    expect(ran).toEqual(["flight@start", "flight@end"]);
    // Narration reports the action scored: post-score opens, then the root settles.
    completion.done();
    step(100);
    expect(ran).toEqual(["flight@start", "flight@end", "graph@start", "graph@end"]);
    expect(rootSettled).toBe(true);
  });

  it("fails a scoring contribution whose producer reports failure, without blocking the root", async () => {
    const { createCompletionAdapter } = await import("./visual-events/action-phases");
    const { scoringProducer } = await import("./placement-phase");
    const scheduler = createVisualScheduler();
    let now = 0;
    scheduler.update(0, true);
    const committed = source();
    const phases = createActionPhases(scheduler, {
      plan: "scoring",
      producers: [placementProducer, scoringProducer],
    });
    const placement = createPlacementPhase(committed, phases);
    committed.commit("p1", ["score.totalApplied"]);
    const key = placement.latest!;
    const completion = createCompletionAdapter();
    const scoring = placement.contributionFor(key, scoringProducer)!;
    scoring.bind(completion.work);
    completion.failed("narration could not be admitted");
    for (let t = 0; t < 100; t += 10) scheduler.update((now += 10), true);
    expect(scoring.status().state).toBe("failed");
    expect(phases.status(key)).toEqual({ state: "finished" });
  });
});
