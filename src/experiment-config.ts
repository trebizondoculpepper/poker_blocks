/**
 * Versioned experiment configuration export (#934, part of #821; doc/experiments/spatial-
 * modifiers.md, "Room controls and exports", and doc/experiments/passive-test-bench.md,
 * "Measurement, export and lifecycle"). The configuration-only product: enough to rebuild the
 * same trial, not its played evidence (that is #935/#936).
 *
 * A configuration is plain JSON: its format and version, the build's source revision, the
 * scenario definition (seed, the deck builder and its actual generation distribution, hand
 * selectors, passive descriptors with their parameter overrides, field placements, any explicit
 * setup commands) and a record of the effective run rules (each stage's dealer and scoring setup,
 * capacities and limits). No functions, listeners, live state or secrets.
 *
 * Import parses and validates without touching any run: an unsupported format or version, a
 * scenario its own builder rejects, or rules that differ from the runtime it would run under,
 * each return diagnostics. `copyConfiguration` is the reusable Copy Configuration capability;
 * where a bench places its button is #937.
 */
import { buildScenario, type ScenarioDefinition, type ScenarioRuntime } from "./dev-scenario";
import { stageKinds, type RunRules, type StageKind, type StageSetup } from "./run-rules";

export const experimentConfigFormat = "poker-blocks.experiment-config";
export const experimentConfigVersion = 1;

/**
 * How many rounds of stage setup a rules record captures by default. Progression is endless, so a
 * record verifies its rules only up to its `horizon`: a reproduced trial is bounded by it, and a
 * replay (#936) must not run past it.
 */
export const recordedRounds = 8;

/** The run rules as plain data: what the rule functions actually give, round by round. */
export type RulesRecord = {
  /** The last round these rules are recorded, and so verified, for. */
  horizon: number;
  stages: { round: number; kind: StageKind; setup: StageSetup }[];
  handAtStageEnd: RunRules["handAtStageEnd"];
  discardPileAfterShop: RunRules["discardPileAfterShop"];
  stageReward?: number;
  rackCapacity?: number;
  resolutionLimits?: { events: number; operations: number };
  playfield?: readonly { id: string; config: unknown }[];
  /** The function-valued policies' plain descriptors (`RunRules.policies`). */
  policies?: Record<string, unknown>;
  /** Function-valued policies present with no descriptor: their behaviour can't be compared. */
  unverifiable?: string[];
};

/** The function-valued rules a record can only compare through their descriptors. */
const policyFields = ["stockShop", "resaleModifiers"] as const;

export type ExperimentConfiguration = {
  format: typeof experimentConfigFormat;
  version: typeof experimentConfigVersion;
  /** The source revision that exported it (the build's version). */
  revision: string;
  scenario: ScenarioDefinition;
  rules: RulesRecord;
};

/** Plain JSON only: functions and undefined are dropped, as they would be on export. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The effective rules as a record, from the rule functions' own answers. */
export function recordRules(rules: RunRules, rounds = recordedRounds): RulesRecord {
  const present = (field: (typeof policyFields)[number]) => [rules[field] ?? []].flat().length > 0;
  const unverifiable = policyFields.filter(
    (field) => present(field) && rules.policies?.[field] === undefined,
  );
  return plain({
    horizon: rounds,
    stages: Array.from({ length: rounds }, (_, index) =>
      stageKinds.map((kind) => ({ round: index + 1, kind, setup: rules.stage(index + 1, kind) })),
    ).flat(),
    handAtStageEnd: rules.handAtStageEnd,
    discardPileAfterShop: rules.discardPileAfterShop,
    stageReward: rules.stageReward,
    // An unlimited rack is recorded by leaving the capacity out.
    rackCapacity: Number.isFinite(rules.rackCapacity) ? rules.rackCapacity : undefined,
    resolutionLimits: rules.resolutionLimits,
    playfield: rules.playfield,
    policies: rules.policies,
    ...(unverifiable.length ? { unverifiable } : {}),
  });
}

/** The configuration of a scenario under these rules, from this build. */
export function exportConfiguration(
  scenario: ScenarioDefinition,
  rules: RunRules,
  revision: string,
  /** The rounds the rules are recorded, and verified, for. */
  rounds = recordedRounds,
): ExperimentConfiguration {
  return {
    format: experimentConfigFormat,
    version: experimentConfigVersion,
    revision,
    scenario: plain(scenario),
    rules: recordRules(rules, rounds),
  };
}

export const serializeConfiguration = (config: ExperimentConfiguration): string =>
  `${JSON.stringify(config, null, 2)}\n`;

export type ImportResult =
  | { ok: true; config: ExperimentConfiguration }
  | { ok: false; diagnostics: readonly string[] };

/** The first path at which two plain values differ, or null when they are equal. */
function difference(a: unknown, b: unknown, path = "rules"): string | null {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null)
    return Object.is(a, b) ? null : path;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const found = difference(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      `${path}.${key}`,
    );
    if (found) return found;
  }
  return null;
}

/**
 * Parse and validate a configuration for a runtime, changing nothing: the scenario is built off
 * to the side by its own builder and discarded, and the rules must be the runtime's own.
 */
export function importConfiguration(text: string, runtime: ScenarioRuntime): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, diagnostics: ["not a JSON configuration"] };
  }
  const config = raw as Partial<ExperimentConfiguration> | null;
  if (config?.format !== experimentConfigFormat)
    return { ok: false, diagnostics: ["not an experiment configuration"] };
  if (config.version !== experimentConfigVersion)
    return {
      ok: false,
      diagnostics: [`unsupported configuration version ${String(config.version)}`],
    };
  if (typeof config.revision !== "string")
    return { ok: false, diagnostics: ["a configuration needs its source revision"] };
  const built = buildScenario(config.scenario as ScenarioDefinition, runtime);
  if (!built.ok) return { ok: false, diagnostics: built.diagnostics };
  const horizon = config.rules?.horizon;
  if (!Number.isSafeInteger(horizon) || horizon! < 1)
    return { ok: false, diagnostics: ["a configuration needs a positive round horizon"] };
  const runtimeRules = recordRules(runtime.rules, horizon);
  const unverifiable = [
    ...(config.rules?.unverifiable ?? []),
    ...(runtimeRules.unverifiable ?? []),
  ];
  if (unverifiable.length)
    return {
      ok: false,
      diagnostics: [`these rules can't be verified: ${[...new Set(unverifiable)].join(", ")}`],
    };
  const differs = difference(config.rules, runtimeRules);
  if (differs)
    return {
      ok: false,
      diagnostics: [`its rules differ from this mode's at ${differs}`],
    };
  return { ok: true, config: config as ExperimentConfiguration };
}

/** Copy Configuration: the serialized configuration onto a clipboard. */
export function copyConfiguration(
  config: ExperimentConfiguration,
  clipboard: Pick<Clipboard, "writeText"> = navigator.clipboard,
): Promise<void> {
  return clipboard.writeText(serializeConfiguration(config));
}
