import { describe, expect, it } from "vite-plus/test";
import {
  configurationArtifact,
  copyBenchArtifact,
  replayArtifact,
  type BenchExportSource,
} from "./bench-export";
import { Registry } from "./core/registry";
import { baseDealer, type Dealer } from "./dealer";
import { buildScenario, scenarioVersion, type ScenarioDefinition } from "./dev-scenario";
import { experimentConfigFormat } from "./experiment-config";
import { createExperimentRecorder } from "./experiment-recorder";
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

/** A clipboard that records what it was given, or refuses. */
function clipboard(refuse = false) {
  const written: string[] = [];
  return {
    written,
    writeText: async (text: string) => {
      if (refuse) throw new Error("permission denied");
      written.push(text);
    },
  };
}

/** A trial installed and recorded from its captured start, as the bench does. */
function trial(): BenchExportSource {
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
        configuration: null,
        snapshot: run.snapshot(),
        ids: {},
        checkpoint: session.random.checkpoint(),
        setup: [],
      }),
    },
  );
  run.play({ cardId: run.state.hand[0]!.id });
  return {
    scenario: () => scenario,
    runtime: () => runtime,
    record: () => recorder.record(),
    build: "b1",
  };
}

describe("bench export controls (#937)", () => {
  it("copies the configuration artifact, labelled, only after the write succeeds", async () => {
    const board = clipboard();
    const outcome = await copyBenchArtifact(configurationArtifact, trial(), board);
    expect(outcome).toEqual({ ok: true, message: "Configuration copied." });
    expect(JSON.parse(board.written[0]!).format).toBe(experimentConfigFormat);
    expect(configurationArtifact.label).toBe("Copy configuration");
  });

  it("copies the trial replay with its configuration and record", async () => {
    const board = clipboard();
    const outcome = await copyBenchArtifact(replayArtifact, trial(), board);
    const replay = JSON.parse(board.written[0]!);
    expect(replay.build).toBe("b1");
    expect(replay.record.actions.length).toBeGreaterThan(0);
    expect(outcome.message.startsWith("Trial replay copied.")).toBe(true);
  });

  it("reports a refused clipboard without claiming a copy", async () => {
    const outcome = await copyBenchArtifact(configurationArtifact, trial(), clipboard(true));
    expect(outcome).toEqual({ ok: false, message: "Couldn't copy: permission denied" });
  });

  it("says what is missing before any trial or recorder, and copies nothing", async () => {
    const board = clipboard();
    const none: BenchExportSource = {
      scenario: () => null,
      runtime: () => runtime,
      record: () => null,
      build: "b1",
    };
    expect(await copyBenchArtifact(configurationArtifact, none, board)).toEqual({
      ok: false,
      message: "Apply a trial before exporting it.",
    });
    const unrecorded = { ...none, scenario: () => scenario };
    expect(await copyBenchArtifact(replayArtifact, unrecorded, board)).toEqual({
      ok: false,
      message: "No trial is being recorded yet.",
    });
    expect(board.written).toEqual([]);
  });

  it("surfaces an unreplayable export's diagnostics rather than reporting plain success", async () => {
    const source = { ...trial(), build: "" };
    const outcome = await copyBenchArtifact(replayArtifact, source, clipboard());
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/can't be replayed/);
  });
});
