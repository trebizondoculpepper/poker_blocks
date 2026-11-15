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
import type { EventRule, RuleFrame } from "./event-rules";
import { passiveRuleBuilders, type ParameterSchema } from "./configurable-passive";
import { passiveDefinitions, type PassiveDefinition } from "./passives";
import { raiseLine, ruleHandlers } from "./rule-handlers";
import { goldSolid, massKg, massOf } from "./physical-mass";
import "./packing-density";
import "./field-mass";
import "./material-diversity";

/** A registered trial curve: its factor for a value, and what's wrong with its parameters. */
export type ScoreCurve = {
  factor(value: number, params: unknown): number;
  validate(params: unknown): string[];
  /**
   * Its adjustable parameters (#876): each one's location in its params and permitted range.
   * A configurable trial offers these to an instance; the curve's `validate` still judges the
   * combination.
   */
  parameters: Readonly<Record<string, CurveParameter>>;
};

/** One adjustable curve parameter. */
export type CurveParameter = {
  label: string;
  path: readonly (string | number)[];
  min: number;
  max: number;
  step?: number;
};

const rampParameters = {
  maximum: { label: "Maximum factor", path: ["maximum"], min: 1, max: 20, step: 0.5 },
  start: { label: "Start", path: ["start"], min: 0.01, max: 0.99, step: 0.01 },
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
  parameters: rampParameters,
});
// Sparse: 1 + (K−1)·clamp((b − d)/b).
scoreCurves.register("sparseRamp", {
  factor: (d, raw) => {
    const { maximum, start } = raw as RampParams;
    return 1 + (maximum - 1) * clamp01((start - d) / start);
  },
  validate: (raw) => rampProblems(raw as RampParams),
  parameters: rampParameters,
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
  parameters: {
    maximum: rampParameters.maximum,
    coefficient: { label: "Coefficient", path: ["coefficient"], min: 0.1, max: 10, step: 0.1 },
    referenceKg: { label: "Reference mass (kg)", path: ["referenceKg"], min: 0.01, max: 100 },
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
  parameters: {
    maximum: rampParameters.maximum,
    referenceKg: { label: "Reference mass (kg)", path: ["referenceKg"], min: 0.01, max: 100 },
  },
});

/** Quadratic ease-out (doc/material-mass-and-passives.md): quick early gain, flat at the cap. */
export const easeOut = (t: number): number => 1 - (1 - t) ** 2;

type MassEaseParams = { neutralKg: number; capKg: number; maximum: number };

/**
 * Light and Heavy (#1072, #1073): ×1 at the neutral mass, ×maximum at the cap mass, eased between
 * with `easeOut`. The cap may lie either side of the neutral mass, so one curve serves both.
 */
scoreCurves.register("massEaseOut", {
  factor: (m, raw) => {
    const { neutralKg, capKg, maximum } = raw as MassEaseParams;
    return 1 + (maximum - 1) * easeOut(clamp01((m - neutralKg) / (capKg - neutralKg)));
  },
  validate: (raw) => {
    const { neutralKg, capKg, maximum } = (raw ?? {}) as Partial<MassEaseParams>;
    return finite(neutralKg!, capKg!, maximum!) &&
      neutralKg! > 0 &&
      capKg! > 0 &&
      neutralKg !== capKg &&
      maximum! >= 1 &&
      maximum! <= 10
      ? []
      : ["needs positive, distinct neutral and cap masses and a maximum from 1 to 10"];
  },
  parameters: {
    maximum: { label: "Maximum factor", path: ["maximum"], min: 1, max: 10, step: 0.1 },
    neutralKg: { label: "Neutral mass (kg)", path: ["neutralKg"], min: 0.01, max: 100 },
    capKg: { label: "Cap mass (kg)", path: ["capKg"], min: 0.01, max: 400 },
  },
});

type ExponentRampParams = { neutral: number; cap: number; maximum: number };

/**
 * Dense and Sparse packing (#1070, #1071): exponent 1 at the neutral packing, `maximum` at the cap,
 * linear between. The cap may lie either side of the neutral value. Bounded at ×1.3 as an exponent.
 */
scoreCurves.register("exponentRamp", {
  factor: (d, raw) => {
    const { neutral, cap, maximum } = raw as ExponentRampParams;
    return 1 + (maximum - 1) * clamp01((d - neutral) / (cap - neutral));
  },
  validate: (raw) => {
    const { neutral, cap, maximum } = (raw ?? {}) as Partial<ExponentRampParams>;
    return finite(neutral!, cap!, maximum!) &&
      neutral! >= 0 &&
      neutral! <= 1 &&
      cap! >= 0 &&
      cap! <= 1 &&
      neutral !== cap &&
      maximum! >= 1 &&
      maximum! <= 1.3
      ? []
      : ["needs distinct neutral and cap packings in [0, 1] and a maximum exponent from 1 to 1.3"];
  },
  parameters: {
    maximum: { label: "Maximum exponent", path: ["maximum"], min: 1, max: 1.3, step: 0.01 },
    neutral: { label: "Neutral packing", path: ["neutral"], min: 0, max: 1, step: 0.01 },
    cap: { label: "Cap packing", path: ["cap"], min: 0, max: 1, step: 0.01 },
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
  // The configured tiers' factors; their thresholds stay as the definition sets them.
  parameters: {
    firstTierFactor: { label: "First tier factor", path: ["tiers", 0, "factor"], min: 1, max: 20 },
    secondTierFactor: {
      label: "Second tier factor",
      path: ["tiers", 1, "factor"],
      min: 1,
      max: 20,
    },
  },
});

/** A query-driven row multiplier's configuration. */
export type QueryFactorConfig = {
  query: string;
  /** Which number in the query's value the curve reads. */
  value: string;
  curve: string;
  params: unknown;
  /**
   * The line phase it applies in (#1072). Absent, `score.beforeLineFinalized`, as every earlier
   * trial was saved; weight passives multiply in `score.lineMultiply`.
   */
  phase?: string;
  /**
   * The registered effect that applies the factor (#1070): absent, the row multiplier; packing
   * passives raise the row to the factor as an exponent with `power-line-score-by-query`.
   */
  effect?: string;
};

/** The curve's factor for the query's value on this pass's snapshot: ×1 when unavailable. */
function queryFactor(config: QueryFactorConfig, frame: Readonly<RuleFrame>): number {
  const snapshot = frame.event.score?.snapshot;
  // Every query gets the row's scored subset as its scope; one that measures the whole field
  // ignores it (doc/experiments/spatial-modifiers.md, "Scoring scope and frequency").
  const scope = { ids: frame.event.score?.scoredIds ?? [] };
  const result = snapshot ? query<Record<string, number>>(config.query, snapshot, scope) : null;
  return result?.available === true
    ? scoreCurves.get(config.curve).factor(result.value[config.value]!, config.params)
    : 1;
}

// A neutral factor doesn't fire at all, so it changes nothing and claims no bonus
// (doc/material-mass-and-passives.md, "Scoring scope, phases and four definitions").
ruleHandlers.registerCondition<QueryFactorConfig, unknown>(
  "query-factor-not-neutral",
  (config, _selected, frame) => queryFactor(config, frame) !== 1,
);

// The row's working score × the curve's factor for the query's value on this pass's snapshot.
ruleHandlers.registerEffect<QueryFactorConfig, unknown>(
  "multiply-line-score-by-query",
  (config, _selected, frame) => {
    const factor = queryFactor(config, frame);
    const before = frame.workingValue ?? 0;
    const after = before * factor;
    // The factor it actually applied, reported as it applies (#483).
    return {
      ...frame,
      workingValue: after,
      outcomes: [
        ...(frame.outcomes ?? []),
        {
          operation: "multiply-line-score-by-query",
          operand: factor,
          before,
          after,
          unit: "score",
          scope: "line",
        },
      ],
    };
  },
);

// The row's working score raised to the curve's value as an exponent (#1070), composed with the
// row's other powers as material exponents are (doc/material-mass-and-passives.md).
ruleHandlers.registerEffect<QueryFactorConfig, unknown>(
  "power-line-score-by-query",
  (config, _selected, frame) =>
    raiseLine(frame, queryFactor(config, frame), "power-line-score-by-query"),
);

/** Everything wrong with a trial's curve configuration (rejected before it can score). */
export function validateQueryFactor(owner: string, config: QueryFactorConfig): string[] {
  if (!scoreCurves.has(config.curve)) return [`${owner}: unknown curve "${config.curve}"`];
  return scoreCurves
    .get(config.curve)
    .validate(config.params)
    .map((problem) => `${owner}: ${problem}`);
}

/** A trial's rules: one row multiplier on each scored line, from its query factor. */
const queryFactorRules = (factor: QueryFactorConfig): EventRule[] => [
  {
    on: factor.phase ?? "score.beforeLineFinalized",
    select: { id: "scored-line", config: {} },
    where: { id: "query-factor-not-neutral", config: factor },
    effects: [{ id: factor.effect ?? "multiply-line-score-by-query", config: factor }],
  },
];

// Instance configuration for a query trial (#876): validated through the same curve validators.
passiveRuleBuilders.register("queryFactor", {
  validate: (owner, config) => validateQueryFactor(owner, config as QueryFactorConfig),
  build: (config) => queryFactorRules(config as QueryFactorConfig),
});

/**
 * A query trial's adjustable parameters: its curve's, located under `params`, plus which value
 * (aggregate) of the query it reads when the trial offers a choice.
 */
const queryFactorParameters = (
  factor: QueryFactorConfig,
  values: readonly string[],
): Record<string, ParameterSchema> => ({
  ...Object.fromEntries(
    Object.entries(scoreCurves.get(factor.curve).parameters).map(([name, parameter]) => [
      name,
      { ...parameter, kind: "number" as const, path: ["params", ...parameter.path] },
    ]),
  ),
  ...(values.length > 1
    ? {
        aggregate: {
          label: "Aggregate",
          kind: "choice" as const,
          path: ["value"],
          options: values,
        },
      }
    : {}),
});

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

/** The shared gold calibration (doc/material-mass-and-passives.md), not a material lookup. */
const goldKg = massKg(massOf(goldSolid));

/**
 * Owner-agreed weight passives (#1061; doc/material-mass-and-passives.md): total field mass,
 * eased from ×1 at the neutral mass to ×10 at the cap, multiplied in `score.lineMultiply`.
 */
export const weightPassives = {
  light: { neutralKg: 1, capKg: 0.1, maximum: 10 },
  // Heavy (#1073): neutral up to one solid gold block's mass, capped at four.
  heavy: { neutralKg: goldKg, capKg: 4 * goldKg, maximum: 10 },
} as const;

/** Owner-agreed packing passives (#1061): exponents on the whole field's packing density. */
export const packingPassives = {
  // Dense (#1070): no bonus at or below 70%, exponent 1.3 when fully packed.
  dense: { neutral: 0.7, cap: 1, maximum: 1.3 },
  // Sparse (#1071): no bonus at or above 20%, exponent 1.3 at or below 10%.
  sparse: { neutral: 0.2, cap: 0.1, maximum: 1.3 },
} as const;

/** A provisional row-multiplier passive driven by a context query, validated as composed. */
function queryTrial(
  id: string,
  name: string,
  symbol: string,
  description: string,
  factor: QueryFactorConfig,
  values: readonly string[] = [factor.value],
  /** Its scoring operation, for its category colours: a row multiplier unless it raises. */
  operations: readonly ("multiplicative" | "exponential")[] = ["multiplicative"],
): PassiveDefinition {
  const problems = validateQueryFactor(id, factor);
  if (problems.length) throw new Error(problems.join("\n"));
  return {
    id,
    // A trial: experimental catalogues only, never normal shops (doc/release-status.md).
    releaseStatus: { provisional: {} },
    lifecycle: { parent: "rackItem" },
    name,
    symbol,
    description,
    traitId: "passive.event-rules",
    categoryTrait: { scoringCategory: { operations: [...operations] } },
    eventRules: queryFactorRules(factor),
    // Its curve's parameters may be adjusted per instance (#876).
    configurable: {
      builder: "queryFactor",
      config: factor,
      parameters: queryFactorParameters(factor, values),
    },
  };
}

for (const definition of [
  // Sparse (#1071): a thinly spread field raises each scored row to up to the power 1.3.
  queryTrial(
    "sparse-packing",
    "Sparse",
    "□",
    "Raises each scored row to a power of up to 1.3 the more thinly the playfield is spread: no bonus at 20% packing or more, 1.3 at 10% or less.",
    {
      query: "packingDensity",
      value: "density",
      curve: "exponentRamp",
      params: packingPassives.sparse,
      phase: "score.linePower",
      effect: "power-line-score-by-query",
    },
    ["density"],
    ["exponential"],
  ),
  // Dense (#1070): a tightly packed field raises each scored row to up to the power 1.3.
  queryTrial(
    "dense-packing",
    "Dense",
    "■",
    "Raises each scored row to a power of up to 1.3 the more tightly the playfield is packed: no bonus at 70% or less, 1.3 when its bounding box is full.",
    {
      query: "packingDensity",
      value: "density",
      curve: "exponentRamp",
      params: packingPassives.dense,
      phase: "score.linePower",
      effect: "power-line-score-by-query",
    },
    ["density"],
    ["exponential"],
  ),
  // Heavy (#1073): a heavier field scores more, from one gold block's mass up to ×10 at four.
  queryTrial(
    "heavy-stack",
    "Heavy",
    "⇩",
    "Multiplies each scored row by up to ×10 the heavier everything in the playfield is: ×1 up to about 19.3 kg (one gold block), ×10 at four gold blocks' mass or more.",
    {
      query: "fieldMass",
      value: "totalKg",
      curve: "massEaseOut",
      params: weightPassives.heavy,
      phase: "score.lineMultiply",
    },
  ),
  // Light (#1072): a lighter field scores more, up to ×10 at or below 0.1 kg.
  queryTrial(
    "light-stack",
    "Light",
    "⇧",
    "Multiplies each scored row by up to ×10 the lighter everything in the playfield is: ×1 at 1 kg or more, ×10 at 0.1 kg or less.",
    {
      query: "fieldMass",
      value: "totalKg",
      curve: "massEaseOut",
      params: weightPassives.light,
      phase: "score.lineMultiply",
    },
  ),
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
        ["meanKg", "totalKg"],
      ),
      queryTrial(
        `trial-light-${label}-mass`,
        `Light, ${label} mass (trial)`,
        "⬆",
        `Multiplies each scored row by up to ×10, more for a lighter ${label} mass of its scored blocks. Provisional trial.`,
        { query: "scoredSubsetMass", value, curve: "lightInverse", params: massTrials.light },
        ["meanKg", "totalKg"],
      ),
    ];
  }),
])
  passiveDefinitions.register(definition.id, definition);

// In the Loop (#886): a provisional exponent trial on the face hoop query.
import "./in-the-loop";
// Could It Be Magic Now? (#988): a provisional per-instance play counter and conversion.
import "./could-it-be-magic";
