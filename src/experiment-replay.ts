/**
 * Experiment replay export and verification (#936; doc/experiments/command-journal.md,
 * "Recorder, provenance and verification"). The versioned artifact combines the trusted build
 * identity, the trial's configuration artifact (#934) and its version-2 command record (#1247).
 *
 * - **Checked before anything is built.** Format and version, the exact build (a journal is not
 *   portable across builds), the record's own replayability (start and commands complete, its
 *   contents agreeing with its flags) and the step bound. A failure here constructs nothing.
 * - **Off to the side.** The candidate trial is rebuilt from the configuration's scenario (its
 *   setup runs once, as installed), its random stream restored to the recorded starting
 *   checkpoint through the stream's own API, then the recorded player commands run in order
 *   through the shared primitive executors (`executeCommand`): never the live trial, its scene,
 *   audio or rewards.
 * - **Compared step by step.** Accepted, the canonical fact sequence and payloads, awarded points,
 *   score and the random checkpoint. Only declared correlation fields are normalized: the fresh
 *   run token and each step's action ID, mapped by index. The first mismatch is reported with its
 *   index, command, expected and actual projections (bounded) and a diagnostic.
 */
import { executeCommand, type CommandDescriptor, type CommittedMetadata } from "./command-codecs";
import { buildScenario, type ScenarioDefinition, type ScenarioRuntime } from "./dev-scenario";
import {
  readExperimentRecord,
  readFacts,
  type ExperimentRecord,
  type RecordedAction,
  type StartingProvenance,
} from "./experiment-recorder";
import type { EventEnvelope } from "./lifecycle/action";

export const experimentReplayFormat = "poker-blocks.experiment-replay";
export const experimentReplayVersion = 1;

/** The longest journal a verification will run. */
export const maxReplaySteps = 512;

export type ExperimentReplay = {
  format: typeof experimentReplayFormat;
  version: typeof experimentReplayVersion;
  /** The exact build that recorded it, as its trusted caller supplied it. */
  build: string;
  /** The configuration artifact (#934) the trial was installed from. */
  configuration: { scenario: ScenarioDefinition } & Record<string, unknown>;
  record: ExperimentRecord;
  /** Whether it may be verified, and why not. */
  replayable: boolean;
  diagnostics: string[];
};

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Combine a trial's configuration and record into a replay artifact. */
export function exportReplay(input: {
  build: string;
  configuration: ExperimentReplay["configuration"];
  record: ExperimentRecord;
}): ExperimentReplay {
  const read = readExperimentRecord(input.record);
  const diagnostics = read.ok ? read.diagnostics : [read.diagnostic];
  if (!input.build) diagnostics.push("no build identity was supplied");
  return plain({
    format: experimentReplayFormat,
    version: experimentReplayVersion,
    build: input.build,
    configuration: input.configuration,
    record: input.record,
    replayable: read.ok && read.replayable && Boolean(input.build),
    diagnostics,
  });
}

/** How far a mismatch's projections are shown. */
const shown = (value: unknown) => {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
};

export type ReplayVerdict =
  | { verified: true; steps: number }
  | { verified: false; stage: "refused"; diagnostic: string }
  | {
      verified: false;
      stage: "mismatch";
      index: number;
      command: string;
      expected: string;
      actual: string;
      diagnostic: string;
    };

/** One step as compared: what it did, with correlation fields normalized. */
type Projection = {
  accepted: boolean;
  facts: unknown;
  awarded: number;
  score: number;
  checkpoint: unknown;
};

const runToken = /\brun\d+:/g;

/** A step's facts as the record keeps them, with its own action ID and the run token neutral. */
const normalized = (facts: unknown, actionId: string): unknown =>
  JSON.parse(
    JSON.stringify(facts ?? [])
      .split(actionId)
      .join("<action>")
      .replace(runToken, "<run>:"),
  );

const recordedFacts = (facts: readonly EventEnvelope[]) =>
  facts.map(({ type, phase, sequence, subjectIds, payload }) =>
    plain({ type, phase, sequence, subjectIds: [...subjectIds], payload }),
  );

/** The points a step awarded, read exactly as the recorder reads them. */
const awardedOf = (facts: readonly EventEnvelope[]) => readFacts(facts).awarded;

/** Verify a replay artifact against this build, off to the side. Mutates nothing live. */
export function verifyReplay(
  artifact: unknown,
  options: { build: string; runtime: ScenarioRuntime; maxSteps?: number },
): ReplayVerdict {
  const refuse = (diagnostic: string): ReplayVerdict => ({
    verified: false,
    stage: "refused",
    diagnostic,
  });
  const replay = artifact as Partial<ExperimentReplay> | null;
  if (
    typeof artifact !== "object" ||
    artifact === null ||
    replay?.format !== experimentReplayFormat
  )
    return refuse("not an experiment replay");
  if (replay.version !== experimentReplayVersion)
    return refuse(`unsupported replay version ${String(replay.version)}`);
  if (!options.build || replay.build !== options.build)
    return refuse(`recorded by build ${String(replay.build)}, not this build (${options.build})`);
  const read = readExperimentRecord(replay.record);
  if (!read.ok) return refuse(read.diagnostic);
  if (!read.replayable) return refuse(`not replayable: ${read.diagnostics.join("; ")}`);
  const record = replay.record as ExperimentRecord;
  const steps = record.actions;
  if (steps.length > (options.maxSteps ?? maxReplaySteps))
    return refuse(
      `${steps.length} steps exceed the ${options.maxSteps ?? maxReplaySteps} step bound`,
    );
  const scenario = replay.configuration?.scenario;
  if (!scenario) return refuse("the configuration holds no scenario to rebuild");

  // The candidate, rebuilt as installed: setup once, then the recorded starting checkpoint.
  const built = buildScenario(scenario, options.runtime);
  if (!built.ok) return refuse(`the trial could not be rebuilt: ${built.diagnostics.join("; ")}`);
  const { run, session } = built.trial;
  session.random.restore((record.start as StartingProvenance).checkpoint);
  let committed: { facts: readonly EventEnvelope[]; metadata: CommittedMetadata }[] = [];
  const stop = run.onCommitted((facts, metadata) => committed.push({ facts, metadata }));
  try {
    for (const [index, step] of steps.entries()) {
      committed = [];
      const command = step.command as CommandDescriptor;
      let accepted = false;
      try {
        accepted = executeCommand(run, command);
      } catch {
        // An executor that throws (an invalid recorded argument) did not commit.
      }
      const own = committed[0];
      const expected: Projection = project(step, step.actionId, step.facts, step.awarded);
      const actual: Projection = {
        accepted,
        facts: normalized(own ? recordedFacts(own.facts) : [], own?.metadata.actionId ?? "\u0000"),
        awarded: own ? awardedOf(own.facts) : 0,
        score: run.state.round.score,
        checkpoint: own?.metadata.checkpoint ?? null,
      };
      const field = (["accepted", "facts", "awarded", "score", "checkpoint"] as const).find(
        (key) => JSON.stringify(expected[key]) !== JSON.stringify(actual[key]),
      );
      if (field)
        return {
          verified: false,
          stage: "mismatch",
          index,
          command: command.command,
          expected: shown(expected[field]),
          actual: shown(actual[field]),
          diagnostic: `step ${index} (${command.command}): its ${field} differs`,
        };
    }
    return { verified: true, steps: steps.length };
  } finally {
    stop();
  }
}

/** A recorded step's projection: it was accepted, with its facts, points, score and checkpoint. */
function project(
  step: RecordedAction,
  actionId: string,
  facts: RecordedAction["facts"],
  awarded: number,
): Projection {
  return {
    accepted: true,
    facts: normalized(facts, actionId),
    awarded,
    score: step.score,
    checkpoint: step.checkpoint ?? null,
  };
}
