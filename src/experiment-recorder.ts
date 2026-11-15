/**
 * The experiment trial recorder (#935, part of #821; doc/experiments/spatial-modifiers.md, "Room
 * controls and exports", doc/experiments/passive-test-bench.md, "Measurement, export and
 * lifecycle", and doc/experiments/trial-session-adoption.md). The evidence half of export: what a
 * trial actually did, after its configuration (#934). Replay export and its verification are
 * #936; where a bench shows or copies this is #937.
 *
 * - **Committed facts only.** It subscribes to the run's committed-action channel, so an invalid
 *   or rolled-back action records nothing, and it never runs inside an action's transaction.
 * - **Immutable snapshots.** Each action's entry is plain data copied as the action commits: its
 *   facts (type, phase, sequence, subjects and captured payload), the points it awarded, the
 *   per-play measurements (the trial readouts' pure queries over the committed state and the
 *   field it scored) and, kept apart, any counterfactual scores. Nothing reads live state later.
 * - **Awarded versus counterfactual.** Awarded points are what the model applied
 *   (`score.totalApplied`). A counterfactual is a separately labelled hypothetical from a
 *   provider the bench composes; it is never added to the awarded total.
 * - **Parameter changes** are logged in order with the actions, by whoever applies them (the
 *   bench's Apply starts a new trial; this marks the boundary).
 * - **Outcome:** the first `stage.won` or `stage.lost` it hears is the trial's final outcome.
 * - **No side effects.** It draws no randomness, mutates nothing, replays nothing when it starts
 *   (a restored or adopted run begins an empty record) and stops listening on `dispose`.
 *
 * Version 2 (#1247; doc/experiments/command-journal.md, "Recorder, provenance and verification"):
 * - **Commands.** Each entry carries the model's committed metadata: its action kind, its
 *   canonical command descriptor (or explicit unavailable reason) and the model random
 *   checkpoint after it. A committed command with no facts (a refill, a reorder) is an entry of its
 *   own, with nothing awarded and no scoring rows or counterfactuals of an earlier play.
 * - **Start.** The installed trial's starting point (configuration artifact, committed snapshot,
 *   logical ID map, starting random checkpoint, setup commands) comes only from the explicit
 *   provider whoever installed the trial supplies, captured once as recording begins. None, or one
 *   that can't say, is recorded as unavailable: never the current cursor or a seed in its place.
 * - **Completeness.** Commands are complete until the first entry without a command codec; from
 *   that index the record is marked incomplete, with the reason. A record is offered for verified
 *   replay only when its start and its commands are both complete.
 * - Version 1 records stay readable (`readExperimentRecord`) as fact evidence, never replayable.
 */
import { Registry } from "./core/registry";
import type { CommittedMetadata } from "./command-codecs";
import type { EventEnvelope } from "./lifecycle/action";
import type { GameState } from "./game-state";
import type { PassiveScoredLine } from "./passive-effects";
import { trialReadout, type TrialReadout } from "./scene-traits/dev-trial-readouts";

export const experimentRecordFormat = "poker-blocks.experiment-record";
export const experimentRecordVersion = 2;

/** What the recorder reads: the run service's committed channel and committed state. */
export type RecorderSource = {
  onCommitted(
    listener: (facts: readonly EventEnvelope[], metadata: CommittedMetadata) => void,
  ): () => void;
  committedState(): Pick<GameState, "field" | "round">;
  lastScoring(): { field: GameState["field"]; lines: readonly PassiveScoredLine[] };
};

/**
 * A hypothetical score the bench wants shown beside the real one (a neutral baseline, or a
 * modifier not installed): labelled, computed from the committed scoring only, never awarded.
 */
export type CounterfactualProvider = (scoring: {
  field: GameState["field"];
  lines: readonly PassiveScoredLine[];
}) => { label: string; score: number } | null;

/** One committed fact, as plain data. */
export type RecordedFact = {
  type: string;
  phase: string;
  sequence: number;
  subjectIds: string[];
  payload: unknown;
};

export type RecordedAction = {
  /** Its place in this trial's record. */
  index: number;
  actionId: string;
  /** The model's name for what kind of action committed. */
  kind: string;
  /** Its canonical command (#1243), or why none is available. */
  command: CommittedMetadata["command"];
  /** The model random source's checkpoint after it, when one is configured. */
  checkpoint?: { state: number; draws: number };
  facts: RecordedFact[];
  /** The points the model actually applied in this action (0 when it scored nothing). */
  awarded: number;
  /** The stage score once it committed. */
  score: number;
  /** Measurements of the committed state and the rows it scored. */
  metrics: TrialReadout;
  /** Hypothetical scores, each labelled; never part of `awarded`. */
  counterfactuals: { label: string; score: number }[];
};

export type ParameterChange = {
  /** The action count it followed: changes before the first action have 0. */
  afterActions: number;
  /** Plain description of the change, as the bench applied it (for example a trial id and settings). */
  change: unknown;
};

/** The installed trial's starting point, as its installer captured it (#1247). */
export type StartingProvenance = {
  /** The validated configuration artifact it was installed from (#934), or null if none. */
  configuration: unknown;
  /** The committed state it began from, as plain data. */
  snapshot: unknown;
  /** Runtime instance IDs to the logical IDs the configuration names. */
  ids: Record<string, string>;
  /** The model random source's checkpoint at the start, before any player command. */
  checkpoint: { state: number; draws: number };
  /** The setup commands executed once before the first player command, in order. */
  setup: readonly unknown[];
};

/** What the record can support: verified replay needs both complete. */
export type RecordCompleteness = {
  start: { complete: true } | { complete: false; reason: string };
  commands: { complete: true } | { complete: false; from: number; reason: string };
};

export type ExperimentRecord = {
  format: typeof experimentRecordFormat;
  version: typeof experimentRecordVersion;
  /** The installed trial's starting provenance, or why it is unavailable. */
  start: StartingProvenance | { unavailable: string };
  completeness: RecordCompleteness;
  /** The committed state when recording began: the trial's starting point. */
  initial: { score: number; field: number };
  actions: RecordedAction[];
  parameterChanges: ParameterChange[];
  /** The first decided outcome heard, or null while the trial is undecided. */
  outcome: { result: "won" | "lost"; actionId: string; score: number } | null;
};

/** A plain, independent copy (JSON data only): later changes to the run cannot reach the record. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** What one committed fact adds to its action's entry, by the fact's type. */
export type FactRecording = (
  fact: EventEnvelope,
  entry: { awarded: number; scored: boolean; outcome: "won" | "lost" | null },
) => void;
/**
 * The facts the recorder reads, registered by fact type like any lifecycle subscriber; every
 * other fact is kept as it is, with nothing derived from it.
 */
export const factRecordings = new Registry<FactRecording>("recorded fact");
factRecordings.register("score.totalApplied", ({ payload }, entry) => {
  const amount = (payload as { amount?: unknown } | null)?.amount;
  entry.scored = true;
  if (typeof amount === "number") entry.awarded += amount;
});
factRecordings.register("stage.won", (_fact, entry) => void (entry.outcome ??= "won"));
factRecordings.register("stage.lost", (_fact, entry) => void (entry.outcome ??= "lost"));

/** Validate a provider's starting provenance: plain, with a finite checkpoint and an ID map. */
function startingProvenance(
  provider: (() => StartingProvenance | { unavailable: string }) | undefined,
): StartingProvenance | { unavailable: string } {
  if (!provider) return { unavailable: "no starting provenance was provided for this trial" };
  let given: StartingProvenance | { unavailable: string };
  try {
    given = provider();
  } catch (error) {
    return {
      unavailable: `starting provenance failed: ${error instanceof Error ? error.message : "unknown"}`,
    };
  }
  if ("unavailable" in given) return { unavailable: String(given.unavailable) };
  const { checkpoint, ids, setup, configuration, snapshot } = given;
  // Without its configuration artifact and starting snapshot the trial can't be rebuilt (#1318
  // review): a provider that can't supply them says so, rather than being taken as complete.
  if (configuration === undefined || configuration === null)
    return { unavailable: "the starting provenance has no configuration artifact" };
  if (snapshot === undefined || snapshot === null)
    return { unavailable: "the starting provenance has no starting snapshot" };
  if (!Number.isFinite(checkpoint?.state) || !Number.isFinite(checkpoint?.draws))
    return { unavailable: "the starting random checkpoint is missing or not finite" };
  if (typeof ids !== "object" || ids === null || !Array.isArray(setup))
    return { unavailable: "the starting provenance has no logical ID map or setup list" };
  return plain(given);
}

/** What an action's committed facts add up to, read through the registered fact recordings. */
export function readFacts(facts: readonly EventEnvelope[]) {
  const entry = { awarded: 0, scored: false, outcome: null as "won" | "lost" | null };
  for (const fact of facts)
    if (factRecordings.has(fact.type)) factRecordings.get(fact.type)(fact, entry);
  return entry;
}

export function createExperimentRecorder(
  source: RecorderSource,
  options: {
    counterfactuals?: readonly CounterfactualProvider[];
    /** The installed trial's starting point, from whoever installed it (#1247). */
    start?: () => StartingProvenance | { unavailable: string };
  } = {},
) {
  const counterfactuals = options.counterfactuals ?? [];
  const start = source.committedState();
  const provenance = startingProvenance(options.start);
  const record: ExperimentRecord = {
    format: experimentRecordFormat,
    version: experimentRecordVersion,
    start: provenance,
    completeness: {
      start:
        "unavailable" in provenance
          ? { complete: false, reason: provenance.unavailable }
          : { complete: true },
      commands: { complete: true },
    },
    initial: { score: start.round.score, field: start.field.length },
    actions: [],
    parameterChanges: [],
    outcome: null,
  };
  let stop: (() => void) | null = source.onCommitted((facts, metadata) => {
    // A committed command with no facts (a refill, a reorder) is still a step (#1247).
    const state = source.committedState();
    const entry = readFacts(facts);
    // Rows count only for an action that scored; otherwise the last scoring is an older play's.
    const scoring = entry.scored ? source.lastScoring() : { field: [], lines: [] };
    const actionId = metadata?.actionId ?? facts[0]?.actionId ?? "unknown";
    const command = metadata?.command ?? { unavailable: "no committed metadata" };
    // The first step without a command codec makes the record's commands incomplete from there.
    if ("unavailable" in command && record.completeness.commands.complete)
      record.completeness.commands = {
        complete: false,
        from: record.actions.length,
        reason: command.unavailable,
      };
    record.actions.push(
      plain({
        index: record.actions.length,
        actionId,
        kind: metadata?.kind ?? "unknown",
        command,
        ...(metadata?.checkpoint ? { checkpoint: { ...metadata.checkpoint } } : {}),
        facts: facts.map(({ type, phase, sequence, subjectIds, payload }) => ({
          type,
          phase,
          sequence,
          subjectIds: [...subjectIds],
          payload,
        })),
        awarded: entry.awarded,
        score: state.round.score,
        metrics: trialReadout(state, scoring),
        counterfactuals: entry.scored
          ? counterfactuals.flatMap((provider) => provider(scoring) ?? [])
          : [],
      }),
    );
    if (entry.outcome && !record.outcome)
      record.outcome = { result: entry.outcome, actionId, score: state.round.score };
  });

  return {
    /** Log a parameter change at this point in the trial, in order with its actions. */
    parameterChanged(change: unknown): void {
      if (!stop) return;
      record.parameterChanges.push(plain({ afterActions: record.actions.length, change }));
    },
    /** The record so far, as an independent plain copy. */
    record(): ExperimentRecord {
      return plain(record);
    },
    /** Stop listening; the record stays readable. */
    dispose(): void {
      stop?.();
      stop = null;
    },
  };
}

export type ExperimentRecorder = ReturnType<typeof createExperimentRecorder>;

/** A record read back for inspection, and whether it may be offered for verified replay. */
export type ReadRecord =
  | { ok: true; version: 1 | 2; record: unknown; replayable: boolean; diagnostics: string[] }
  | { ok: false; diagnostic: string };

/**
 * Read an exported record (#1247). Version 2 is replayable only when its start and commands are
 * complete; version 1 recorded facts, not commands, so it stays inspectable evidence and is never
 * upgraded to verified replay by guessing them.
 */
export function readExperimentRecord(value: unknown): ReadRecord {
  const record = value as Omit<Partial<ExperimentRecord>, "version"> & { version?: unknown };
  if (typeof value !== "object" || value === null || record.format !== experimentRecordFormat)
    return { ok: false, diagnostic: "not an experiment record" };
  if (record.version === 1)
    return {
      ok: true,
      version: 1,
      record: plain(value),
      replayable: false,
      diagnostics: ["version 1 records facts, not commands: inspectable only, never replayed"],
    };
  if (record.version !== experimentRecordVersion)
    return {
      ok: false,
      diagnostic: `unsupported experiment record version ${String(record.version)}`,
    };
  const { start, commands } = record.completeness ?? {};
  const diagnostics = [
    ...(start && !start.complete ? [`start unavailable: ${start.reason}`] : []),
    ...(commands && !commands.complete
      ? [`commands incomplete from step ${commands.from}: ${commands.reason}`]
      : []),
  ];
  // The flags are claims: an imported record is replayable only if its contents agree (#1318
  // review): a starting provenance actually present, every action carrying a command.
  const provenance = record.start as
    | Partial<StartingProvenance>
    | { unavailable: string }
    | undefined;
  const startPresent =
    typeof provenance === "object" &&
    provenance !== null &&
    !("unavailable" in provenance) &&
    provenance.configuration != null &&
    provenance.snapshot != null &&
    Number.isFinite(provenance.checkpoint?.state) &&
    Number.isFinite(provenance.checkpoint?.draws) &&
    typeof provenance.ids === "object" &&
    Array.isArray(provenance.setup);
  if (!startPresent) diagnostics.push("the record holds no usable starting provenance");
  const actions = Array.isArray(record.actions) ? record.actions : null;
  if (!actions) diagnostics.push("the record holds no action list");
  const uncovered = (actions ?? []).findIndex(
    (step) =>
      typeof step?.command !== "object" || step.command === null || "unavailable" in step.command,
  );
  if (uncovered >= 0) diagnostics.push(`step ${uncovered} carries no command`);
  return {
    ok: true,
    version: 2,
    record: plain(value),
    replayable: Boolean(
      start?.complete && commands?.complete && startPresent && actions && uncovered < 0,
    ),
    diagnostics: [...new Set(diagnostics)],
  };
}
