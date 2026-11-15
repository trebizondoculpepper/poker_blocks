import { describe, expect, it } from "vite-plus/test";
import { Registry } from "./core/registry";
import { baseDealer, type Dealer } from "./dealer";
import { buildScenario, scenarioVersion, type ScenarioDefinition } from "./dev-scenario";
import { exportConfiguration } from "./experiment-config";
import { createExperimentRecorder, type ExperimentRecord } from "./experiment-recorder";
import { exportReplay, verifyReplay } from "./experiment-replay";
import type { RunRules } from "./run-rules";

const dealers = new Registry<Dealer>("dealer");
dealers.register(baseDealer.name, baseDealer);
const rules: RunRules = {
  stage: () => ({ dealer: "base", targetScore: 1000, plays: 10, discards: 10 }),
  handAtStageEnd: "return-to-deck",
  discardPileAfterShop: "keep-out",
};
const runtime = { dealers, rules };

const scenario: ScenarioDefinition = {
  version: scenarioVersion,
  seed: 7,
  steps: [
    {
      capability: "devDeck",
      config: { steps: [{ operation: "standardTemplates" }, { operation: "shuffle" }] },
    },
    { capability: "devHand", config: { indices: [0, 1, 2, 3, 4, 5, 6, 7] } },
  ],
};
/** The trial's configuration artifact, as the given build exports it (#934). */
const configFor = (build: string) => exportConfiguration(scenario, runtime, build);

/** A live installed trial, recorded through a play, a refill attempt, a discard, a refill and a reorder. */
function recordTrial() {
  const built = buildScenario(scenario, runtime);
  if (!built.ok) throw new Error(built.diagnostics.join("\n"));
  const { run, session } = built.trial;
  const recorder = createExperimentRecorder(
    {
      onCommitted: run.onCommitted.bind(run),
      committedState: () => run.state,
      lastScoring: () => ({ field: run.lastScoringField, lines: run.lastScoredLines }),
    },
    {
      start: () => ({
        configuration: configFor("b"),
        snapshot: run.snapshot(),
        ids: {},
        checkpoint: session.random.checkpoint(),
        setup: [],
      }),
    },
  );
  run.play({ cardId: run.state.hand[0]!.id });
  run.refillHand();
  run.discard([run.state.hand[1]!.id, run.state.hand[2]!.id]);
  run.refillHand();
  run.reorderHand(0, 3);
  return { run, session, record: recorder.record() };
}

describe("experiment replay export and verification (#936; doc/experiments/command-journal.md)", () => {
  it("exports a replayable artifact and verifies it step by step on the same build", () => {
    const { record } = recordTrial();
    const artifact = exportReplay({
      build: "build-1",
      configuration: configFor("build-1"),
      record,
    });
    // The first refill drew nothing (the hand was still full), so it is no step at all.
    expect(record.actions.map(({ kind }) => kind)).toEqual([
      "play",
      "discard",
      "refillHand",
      "reorderHand",
    ]);
    expect(artifact).toMatchObject({ replayable: true, diagnostics: [] });
    expect(verifyReplay(artifact, { build: "build-1", runtime })).toEqual({
      verified: true,
      steps: 4,
    });
  });

  it("refuses another build, before rebuilding anything", () => {
    const artifact = exportReplay({
      build: "build-1",
      configuration: configFor("build-1"),
      record: recordTrial().record,
    });
    const verdict = verifyReplay(artifact, { build: "build-2", runtime });
    expect(verdict).toMatchObject({ verified: false, stage: "refused" });
    expect((verdict as { diagnostic: string }).diagnostic).toContain("not this build");
  });

  it("refuses a record that is not replayable, or longer than the bound", () => {
    const { record } = recordTrial();
    const incomplete: ExperimentRecord = {
      ...record,
      start: { unavailable: "installed mid-session" },
      completeness: {
        ...record.completeness,
        start: { complete: false, reason: "installed mid-session" },
      },
    };
    const notReplayable = verifyReplay(
      exportReplay({ build: "b", configuration: configFor("b"), record: incomplete }),
      {
        build: "b",
        runtime,
      },
    );
    expect(notReplayable).toMatchObject({ stage: "refused" });
    expect((notReplayable as { diagnostic: string }).diagnostic).toContain("not replayable");
    expect(
      verifyReplay(exportReplay({ build: "b", configuration: configFor("b"), record }), {
        build: "b",
        runtime,
        maxSteps: 2,
      }),
    ).toMatchObject({ stage: "refused", diagnostic: expect.stringContaining("step bound") });
  });

  it("reports the first mismatch with its step, command and projections", () => {
    const { record } = recordTrial();
    const tampered: ExperimentRecord = JSON.parse(JSON.stringify(record));
    tampered.actions[1]!.score += 5;
    tampered.actions[2]!.awarded += 9;
    const verdict = verifyReplay(
      exportReplay({ build: "b", configuration: configFor("b"), record: tampered }),
      {
        build: "b",
        runtime,
      },
    );
    expect(verdict).toMatchObject({
      verified: false,
      stage: "mismatch",
      index: 1,
      command: "discard",
      diagnostic: "step 1 (discard): its score differs",
    });
  });

  it("catches a changed fact, not hidden by normalization", () => {
    const { record } = recordTrial();
    const tampered: ExperimentRecord = JSON.parse(JSON.stringify(record));
    tampered.actions[0]!.facts[0]!.type = "something.else";
    expect(
      verifyReplay(exportReplay({ build: "b", configuration: configFor("b"), record: tampered }), {
        build: "b",
        runtime,
      }),
    ).toMatchObject({ stage: "mismatch", index: 0, diagnostic: expect.stringContaining("facts") });
  });

  it("leaves the live trial exactly as it was", () => {
    const { run, session, record } = recordTrial();
    const state = run.state;
    const mark = session.random.checkpoint();
    verifyReplay(exportReplay({ build: "b", configuration: configFor("b"), record }), {
      build: "b",
      runtime,
    });
    expect(run.state).toBe(state);
    expect(session.random.checkpoint()).toEqual(mark);
  });

  it("refuses something that isn't a replay artifact", () => {
    expect(verifyReplay({ format: "other" }, { build: "b", runtime })).toMatchObject({
      stage: "refused",
      diagnostic: "not an experiment replay",
    });
  });

  it("refuses a configuration this runtime does not reproduce, before rebuilding (#1329 review)", () => {
    const { record } = recordTrial();
    const changed = {
      ...runtime,
      rules: {
        ...rules,
        stage: () => ({ dealer: "base", targetScore: 5, plays: 10, discards: 10 }),
      },
    };
    const verdict = verifyReplay(
      exportReplay({ build: "b", configuration: configFor("b"), record }),
      {
        build: "b",
        runtime: changed as never,
      },
    );
    expect(verdict).toMatchObject({
      stage: "refused",
      diagnostic: expect.stringContaining("configuration"),
    });
  });

  it("refuses a record whose starting snapshot the rebuilt trial does not reproduce", () => {
    const { record } = recordTrial();
    const moved: ExperimentRecord = JSON.parse(JSON.stringify(record));
    (moved.start as { snapshot: { round: number } }).snapshot.round = 99;
    expect(
      verifyReplay(exportReplay({ build: "b", configuration: configFor("b"), record: moved }), {
        build: "b",
        runtime,
      }),
    ).toMatchObject({ stage: "refused", diagnostic: expect.stringContaining("starting snapshot") });
  });

  it("refuses a malformed step before running anything", () => {
    const { record } = recordTrial();
    const broken: ExperimentRecord = JSON.parse(JSON.stringify(record));
    broken.actions[1]!.actionId = "";
    expect(
      verifyReplay(exportReplay({ build: "b", configuration: configFor("b"), record: broken }), {
        build: "b",
        runtime,
      }),
    ).toMatchObject({ stage: "refused", diagnostic: "step 1 is malformed" });
  });

  it("normalizes only correlation fields: a card ID equal to an action ID is still compared", () => {
    const built = buildScenario(scenario, runtime);
    if (!built.ok) throw new Error("scenario");
    const { run, session } = built.trial;
    const recorder = createExperimentRecorder(
      {
        onCommitted: run.onCommitted.bind(run),
        committedState: () => run.state,
        lastScoring: () => ({ field: run.lastScoringField, lines: run.lastScoredLines }),
      },
      {
        start: () => ({
          configuration: configFor("b"),
          snapshot: run.snapshot(),
          ids: {},
          checkpoint: session.random.checkpoint(),
          setup: [],
        }),
      },
    );
    const cardId = run.state.hand[0]!.id;
    run.play({ cardId }, cardId);
    const record = recorder.record();
    // An honest record verifies: the step's own action ID is a correlation field only.
    expect(
      verifyReplay(exportReplay({ build: "b", configuration: configFor("b"), record }), {
        build: "b",
        runtime,
      }),
    ).toEqual({ verified: true, steps: 1 });
    // The same card ID in its facts is gameplay data, compared as recorded: a change is caught.
    const tampered: ExperimentRecord = JSON.parse(
      JSON.stringify(record).split(cardId).join("other-card"),
    );
    expect(
      verifyReplay(exportReplay({ build: "b", configuration: configFor("b"), record: tampered }), {
        build: "b",
        runtime,
      }),
    ).toMatchObject({ verified: false });
  });

  it("verifies the recorded outcome against the one the journal reaches (#1329 review)", () => {
    const { record } = recordTrial();
    expect(record.outcome).toBeNull();
    const claimed: ExperimentRecord = JSON.parse(JSON.stringify(record));
    claimed.outcome = { result: "won", actionId: claimed.actions[0]!.actionId, score: 0 };
    expect(
      verifyReplay(exportReplay({ build: "b", configuration: configFor("b"), record: claimed }), {
        build: "b",
        runtime,
      }),
    ).toMatchObject({ verified: false, stage: "mismatch", command: "outcome" });
  });

  it("compares the starting snapshot independently of key order (#1329 review)", () => {
    const { record } = recordTrial();
    const reorder = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reorder)
        : typeof value === "object" && value !== null
          ? Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([key, inner]) => [key, reorder(inner)]),
            )
          : value;
    const sorted: ExperimentRecord = {
      ...record,
      start: {
        ...(record.start as object),
        snapshot: reorder((record.start as { snapshot: unknown }).snapshot),
      } as never,
    };
    expect(
      verifyReplay(exportReplay({ build: "b", configuration: configFor("b"), record: sorted }), {
        build: "b",
        runtime,
      }),
    ).toMatchObject({ verified: true });
  });
});
