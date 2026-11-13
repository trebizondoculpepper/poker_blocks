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
import "./field-mass";
import "./material-diversity";

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

type HeavyParams = { maximum: number; coefficient: number; referenceKg: number };
type LightParams = { maximum: number; referenceKg: number };

// Heavy: min(K, 1 + c·ln(1 + m/m0)), logarithmic so more mass gives diminishing gains.
scoreCurves.register("heavyLog", {
  factor: (m, raw) => {
    const { maximum, coefficient, referenceKg } = raw as HeavyParams;
    return Math.min(maximum, 1 + coefficient * Math.log(1 + m / referenceKg));
  },
  validate: (raw) => {
    const { maximum, coefficient, referenceKg } = raw as HeavyParams;
    return finite(maximum, coefficient, referenceKg) &&
      maximum >= 1 &&
      coefficient > 0 &&
      referenceKg > 0
      ? []
      : ["needs a finite maximum ≥ 1, a positive coefficient and a positive reference mass"];
  },
});
// Light: 1 + (K−1)/(1 + m/m0), bounded, approaching ×1 for large mass, no singularity.
scoreCurves.register("lightInverse", {
  factor: (m, raw) => {
    const { maximum, referenceKg } = raw as LightParams;
    return 1 + (maximum - 1) / (1 + m / referenceKg);
  },
  validate: (raw) => {
    const { maximum, referenceKg } = raw as LightParams;
    return finite(maximum, referenceKg) && maximum >= 1 && referenceKg > 0
      ? []
      : ["needs a finite maximum ≥ 1 and a positive reference mass"];
  },
});

type TierParams = { tiers: readonly { at: number; factor: number }[] };

// The greatest attained tier's factor, ×1 below the first: tiers don't multiply together.
scoreCurves.register("thresholdTiers", {
  factor: (value, raw) =>
    (raw as TierParams).tiers.reduce(
      (factor, tier) => (value >= tier.at ? tier.factor : factor),
      1,
    ),
  validate: (raw) => {
    const { tiers = [] } = (raw ?? {}) as Partial<TierParams>;
    const ordered = tiers.every((tier, index) => index === 0 || tier.at > tiers[index - 1]!.at);
    return tiers.length &&
      ordered &&
      tiers.every(({ at, factor }) => finite(at, factor) && factor >= 1)
      ? []
      : ["needs tiers in rising order, each with a finite factor ≥ 1"];
  },
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
    // Every query gets the row's scored subset as its scope; one that measures the whole field
    // ignores it (doc/experiments/spatial-modifiers.md, "Scoring scope and frequency").
    const scope = { ids: frame.event.score?.scoredIds ?? [] };
    const result = snapshot ? query<Record<string, number>>(config.query, snapshot, scope) : null;
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

/** The exported initial diversity tiers: two families ×2, three or more ×4. */
export const diversityTrial = {
  tiers: [
    { at: 2, factor: 2 },
    { at: 3, factor: 4 },
  ],
} as const;

/** The exported initial mass trial parameters (designer suggestions, not balance). */
export const massTrials = {
  heavy: { maximum: 10, coefficient: 3, referenceKg: 1 },
  light: { maximum: 10, referenceKg: 0.2 },
} as const;

/** A provisional row-multiplier passive driven by a context query, validated as composed. */
function queryTrial(
  id: string,
  name: string,
  symbol: string,
  description: string,
  factor: QueryFactorConfig,
): PassiveDefinition {
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
  queryTrial(
    "trial-dense-packing",
    "Dense (trial)",
    "▣",
    "Multiplies each scored row by up to ×10 as the field's packing density rises past 70%. Provisional trial.",
    { query: "packingDensity", value: "density", curve: "denseRamp", params: packingTrials.dense },
  ),
  queryTrial(
    "trial-sparse-packing",
    "Sparse (trial)",
    "⬚",
    "Multiplies each scored row by up to ×10 as the field's packing density falls below 20%. Provisional trial.",
    {
      query: "packingDensity",
      value: "density",
      curve: "sparseRamp",
      params: packingTrials.sparse,
    },
  ),
  queryTrial(
    "trial-material-diversity",
    "Diversity (trial)",
    "◈",
    "Multiplies each scored row by ×2 for two material families among its scored blocks, ×4 for three or more. Provisional trial.",
    {
      query: "materialDiversity",
      value: "families",
      curve: "thresholdTiers",
      params: diversityTrial,
    },
  ),
  // Heavy and light (#818), each on the row's scored subset, by mean and by total mass.
  ...(
    [
      { value: "meanKg", label: "mean" },
      { value: "totalKg", label: "total" },
    ] as const
  ).flatMap(({ value, label }) => {
    return [
      queryTrial(
        `trial-heavy-${label}-mass`,
        `Heavy, ${label} mass (trial)`,
        "⬇",
        `Multiplies each scored row by up to ×10, more for a heavier ${label} mass of its scored blocks. Provisional trial.`,
        { query: "scoredSubsetMass", value, curve: "heavyLog", params: massTrials.heavy },
      ),
      queryTrial(
        `trial-light-${label}-mass`,
        `Light, ${label} mass (trial)`,
        "⬆",
        `Multiplies each scored row by up to ×10, more for a lighter ${label} mass of its scored blocks. Provisional trial.`,
        { query: "scoredSubsetMass", value, curve: "lightInverse", params: massTrials.light },
      ),
    ];
  }),
])
  passiveDefinitions.register(definition.id, definition);
