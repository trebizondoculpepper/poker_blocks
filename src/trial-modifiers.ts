/**
 * Provisional spatial and material scoring trials (#817; doc/experiments/spatial-modifiers.md,
 * "Provisional modifier implementation contract"). A trial passive contributes one row
 * multiplier to each scored row, once per installed copy, through the ordinary line-finalization
 * rules: its effect asks a registered context query about the scoring pass's own snapshot, and a
 * registered curve turns that value into the factor. Generic scoring names none of this.
 *
 * Every trial definition is provisional: only explicitly experimental catalogues offer it.
 * Curve parameters are configuration, validated when the definition is composed; an unavailable
 * query (no scored field) is a neutral ×1, never an invented value.
 */
import { Registry } from "./core/registry";
import { query } from "./context-queries";
import type { HandlerConfig } from "./event-rules";
import { passiveDefinitions, type PassiveDefinition } from "./passives";
import { ruleHandlers } from "./rule-handlers";
import "./packing-density";

/** A registered trial curve: its factor for a value, and what's wrong with its parameters. */
export type ScoreCurve = {
  factor(value: number, params: unknown): number;
  validate(params: unknown): string[];
};
export const scoreCurves = new Registry<ScoreCurve>("score curve");

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const finite = (...values: unknown[]) => values.every((value) => Number.isFinite(value));

type RampParams = { maximum: number; start: number };
const rampProblems = ({ maximum, start }: RampParams) =>
  !finite(maximum, start) || maximum < 1 || !(start > 0 && start < 1)
    ? ["needs a finite maximum ≥ 1 and a start strictly between 0 and 1"]
    : [];

// Dense: 1 + (K−1)·clamp((d − a)/(1 − a)).
scoreCurves.register("denseRamp", {
  factor: (d, raw) => {
    const { maximum, start } = raw as RampParams;
    return 1 + (maximum - 1) * clamp01((d - start) / (1 - start));
  },
  validate: (raw) => rampProblems(raw as RampParams),
});
// Sparse: 1 + (K−1)·clamp((b − d)/b).
scoreCurves.register("sparseRamp", {
  factor: (d, raw) => {
    const { maximum, start } = raw as RampParams;
    return 1 + (maximum - 1) * clamp01((start - d) / start);
  },
  validate: (raw) => rampProblems(raw as RampParams),
});

/** A query-driven row multiplier's configuration. */
export type QueryFactorConfig = {
  query: string;
  /** Which number in the query's value the curve reads. */
  value: string;
  curve: string;
  params: unknown;
};

// The row's working score × the curve's factor for the query's value on this pass's snapshot.
ruleHandlers.registerEffect<QueryFactorConfig, unknown>(
  "multiply-line-score-by-query",
  (config, _selected, frame) => {
    const snapshot = frame.event.score?.snapshot;
    const result = snapshot ? query<Record<string, number>>(config.query, snapshot) : null;
    const factor =
      result?.available === true
        ? scoreCurves.get(config.curve).factor(result.value[config.value]!, config.params)
        : 1;
    return { ...frame, workingValue: (frame.workingValue ?? 0) * factor };
  },
);

/** Everything wrong with a trial's curve configuration (rejected before it can score). */
export function validateQueryFactor(owner: string, config: QueryFactorConfig): string[] {
  if (!scoreCurves.has(config.curve)) return [`${owner}: unknown curve "${config.curve}"`];
  return scoreCurves
    .get(config.curve)
    .validate(config.params)
    .map((problem) => `${owner}: ${problem}`);
}

/** The exported initial trial parameters (designer suggestions, not balance). */
export const packingTrials = {
  dense: { maximum: 10, start: 0.7 },
  sparse: { maximum: 10, start: 0.2 },
} as const;

/** A provisional row-multiplier passive driven by the packing query, validated as composed. */
function packingTrial(
  id: string,
  name: string,
  symbol: string,
  description: string,
  curve: string,
  params: RampParams,
): PassiveDefinition {
  const factor: QueryFactorConfig = { query: "packingDensity", value: "density", curve, params };
  const problems = validateQueryFactor(id, factor);
  if (problems.length) throw new Error(problems.join("\n"));
  const effect: HandlerConfig = { id: "multiply-line-score-by-query", config: factor };
  return {
    id,
    // A trial: experimental catalogues only, never normal shops (doc/release-status.md).
    releaseStatus: { provisional: {} },
    name,
    symbol,
    description,
    traitId: "passive.event-rules",
    categoryTrait: { scoringCategory: { operations: ["multiplicative"] } },
    eventRules: [
      {
        on: "score.beforeLineFinalized",
        select: { id: "scored-line", config: {} },
        where: { id: "always", config: {} },
        effects: [effect],
      },
    ],
  };
}

for (const definition of [
  packingTrial(
    "trial-dense-packing",
    "Dense (trial)",
    "▣",
    "Multiplies each scored row by up to ×10 as the field's packing density rises past 70%. Provisional trial.",
    "denseRamp",
    packingTrials.dense,
  ),
  packingTrial(
    "trial-sparse-packing",
    "Sparse (trial)",
    "⬚",
    "Multiplies each scored row by up to ×10 as the field's packing density falls below 20%. Provisional trial.",
    "sparseRamp",
    packingTrials.sparse,
  ),
])
  passiveDefinitions.register(definition.id, definition);
