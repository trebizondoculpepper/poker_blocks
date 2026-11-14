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
 */
import { Registry } from "./core/registry";
import type { EventEnvelope } from "./lifecycle/action";
import type { GameState } from "./game-state";
import type { PassiveScoredLine } from "./passive-effects";
import { trialReadout, type TrialReadout } from "./scene-traits/dev-trial-readouts";

export const experimentRecordFormat = "poker-blocks.experiment-record";
export const experimentRecordVersion = 1;

/** What the recorder reads: the run service's committed channel and committed state. */
export type RecorderSource = {
  onCommitted(listener: (facts: readonly EventEnvelope[]) => void): () => void;
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

export type ExperimentRecord = {
  format: typeof experimentRecordFormat;
  version: typeof experimentRecordVersion;
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

export function createExperimentRecorder(
  source: RecorderSource,
  options: { counterfactuals?: readonly CounterfactualProvider[] } = {},
) {
  const counterfactuals = options.counterfactuals ?? [];
  const start = source.committedState();
  const record: ExperimentRecord = {
    format: experimentRecordFormat,
    version: experimentRecordVersion,
    initial: { score: start.round.score, field: start.field.length },
    actions: [],
    parameterChanges: [],
    outcome: null,
  };
  let stop: (() => void) | null = source.onCommitted((facts) => {
    if (!facts.length) return;
    const state = source.committedState();
    const entry = { awarded: 0, scored: false, outcome: null as "won" | "lost" | null };
    for (const fact of facts)
      if (factRecordings.has(fact.type)) factRecordings.get(fact.type)(fact, entry);
    // Rows count only for an action that scored; otherwise the last scoring is an older play's.
    const scoring = entry.scored ? source.lastScoring() : { field: [], lines: [] };
    const actionId = facts[0]!.actionId;
    record.actions.push(
      plain({
        index: record.actions.length,
        actionId,
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
