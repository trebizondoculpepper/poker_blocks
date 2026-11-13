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
import { effectiveSettings } from "./configurable-passive";
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
  /**
   * What the scenario actually builds in this build: every created card's traits, in build order
   * (doc/deck-builders.md, "Determinism and restoration"), and each starting passive with its
   * resolved settings, defaults included (doc/experiments/passive-test-bench.md, "Measurement,
   * export and lifecycle"). A re-resolved pool or a changed passive default fails import.
   */
  generated: { cards: unknown[]; passives: unknown[] };
  rules: RulesRecord;
};

/** The longest rules horizon an import will record and compare. */
export const maxRecordedHorizon = 256;

/** The created cards' traits, in build order, as plain data. */
function generatedCards(scenario: ScenarioDefinition, runtime: ScenarioRuntime) {
  const built = buildScenario(scenario, runtime);
  return built.ok
    ? {
        ok: true as const,
        generated: plain({
          cards: built.trial.session.cards.map(({ traits }) => traits),
          passives: built.trial.run.state.passiveRack.map((block) => ({
            definitionId: block.definitionId,
            settings: Object.fromEntries(
              effectiveSettings(block).map(({ name, value }) => [name, value]),
            ),
          })),
        }),
      }
    : built;
}

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
  runtime: ScenarioRuntime,
  revision: string,
  /** The rounds the rules are recorded, and verified, for. */
  rounds = recordedRounds,
): ExperimentConfiguration {
  const generated = generatedCards(scenario, runtime);
  if (!generated.ok) throw new Error(generated.diagnostics.join("; "));
  return {
    format: experimentConfigFormat,
    version: experimentConfigVersion,
    revision,
    scenario: plain(scenario),
    generated: generated.generated,
    rules: recordRules(runtime.rules, rounds),
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
  const built = generatedCards(config.scenario as ScenarioDefinition, runtime);
  if (!built.ok) return { ok: false, diagnostics: built.diagnostics };
  if (typeof config.generated !== "object" || config.generated === null)
    return { ok: false, diagnostics: ["a configuration needs what its scenario generated"] };
  const changed = difference(config.generated, built.generated, "generated");
  if (changed)
    return {
      ok: false,
      diagnostics: [`this build generates a different trial from the scenario, at ${changed}`],
    };
  const horizon = config.rules?.horizon;
  if (!Number.isSafeInteger(horizon) || horizon! < 1 || horizon! > maxRecordedHorizon)
    return {
      ok: false,
      diagnostics: [`a configuration needs a round horizon from 1 to ${maxRecordedHorizon}`],
    };
  const recorded: unknown = config.rules?.unverifiable ?? [];
  if (!Array.isArray(recorded) || !recorded.every((field) => typeof field === "string"))
    return { ok: false, diagnostics: ["rules.unverifiable must be a list of rule names"] };
  const runtimeRules = recordRules(runtime.rules, horizon);
  const unverifiable = [...(recorded as string[]), ...(runtimeRules.unverifiable ?? [])];
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
