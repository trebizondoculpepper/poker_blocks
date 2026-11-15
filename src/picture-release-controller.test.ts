import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import type { CommittedMetadata } from "./command-codecs";
import type { EventEnvelope } from "./lifecycle/action";
import {
  createPictureReleaseController,
  pictureReleaseProducer,
} from "./picture-release-controller";
import { createPlacementPhase, placementProducer, scoringProducer } from "./placement-phase";
import { graphProducer } from "./score-graph-controller";
import { createActionPhases, createCompletionAdapter } from "./visual-events/action-phases";
import { createVisualScheduler, unitMs } from "./visual-events/scheduler";

type Listener = (facts: readonly EventEnvelope[], metadata: CommittedMetadata) => void;

function harness() {
  const scheduler = createVisualScheduler();
  let now = 0;
  scheduler.update(0, true);
  const step = (ms: number) => {
    for (let t = 0; t < ms; t += 10) scheduler.update((now += 10), true);
  };
  const listeners: Listener[] = [];
  const source = {
    onCommitted(listener: Listener) {
      listeners.push(listener);
      return () => void listeners.splice(listeners.indexOf(listener), 1);
    },
  };
  const phases = createActionPhases(scheduler, {
    plan: "scoring",
    producers: [placementProducer, scoringProducer, graphProducer, pictureReleaseProducer],
  });
  const phase = createPlacementPhase(source, phases);
  const object = new THREE.Group();
  const cues: string[] = [];
  const controller = createPictureReleaseController({
    source,
    phase,
    scheduler,
    target: {
      object,
      attachments: new Map([
        ["left", new THREE.Vector3(-1, 0.5, 0)],
        ["right", new THREE.Vector3(1, 0.5, 0)],
      ]),
    },
    reducedMotion: () => false,
    impact: (cue) => cues.push(cue),
  });
  const commit = (actionId: string, types: string[]) => {
    const facts = types.map((type) => ({ type, payload: {} })) as unknown as EventEnvelope[];
    for (const listener of listeners.slice()) listener(facts, { actionId } as CommittedMetadata);
    return phase.latest!;
  };
  const complete = (key: ReturnType<typeof commit>, producer: string) => {
    const completion = createCompletionAdapter();
    phase.contributionFor(key, producer)!.bind(completion.work);
    return completion;
  };
  return { controller, commit, complete, step, cues, object, phases };
}

describe("loss release of the hung graph (#1065)", () => {
  it("drops only after the failing action's own plot update has finished", () => {
    const { commit, complete, step, cues, object } = harness();
    const key = commit("lose", ["score.totalApplied", "stage.lost"]);
    complete(key, scoringProducer).done();
    const plot = complete(key, graphProducer);
    step(40 * unitMs);
    // Still waiting on the graph's plot: the picture hasn't moved.
    expect(object.position.toArray()).toEqual([0, 0, 0]);
    expect(cues).toEqual([]);
    plot.done();
    step(20 * unitMs);
    expect(cues).toEqual(["picture.impact"]);
  });

  it("does nothing for an action that didn't lose, and releases once per showing", () => {
    const { commit, complete, step, cues } = harness();
    const won = commit("play", ["score.totalApplied"]);
    complete(won, scoringProducer).done();
    complete(won, graphProducer).done();
    step(30 * unitMs);
    expect(cues).toEqual([]);
    for (const id of ["l1", "l2"]) commit(id, ["stage.lost"]);
    step(40 * unitMs);
    expect(cues).toEqual(["picture.impact"]);
  });

  it("never holds the action: its phases settle while the picture is still falling", () => {
    const { commit, step, cues, phases } = harness();
    const key = commit("lose", ["stage.lost"]);
    step(3 * unitMs);
    expect(phases.status(key)).toEqual({ state: "finished" });
    expect(cues).toEqual([]);
    step(20 * unitMs);
    expect(cues).toEqual(["picture.impact"]);
  });

  it("leaving mid-fall cancels it once: no later impact", () => {
    const { controller, commit, step, cues } = harness();
    commit("lose", ["stage.lost"]);
    step(3 * unitMs);
    controller.dispose();
    controller.dispose();
    step(30 * unitMs);
    expect(cues).toEqual([]);
  });
});
