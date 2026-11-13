/**
 * Per-instance passive configuration (#876; doc/experiments/passive-test-bench.md, "Instance
 * configuration"). A definition may declare the `configurable` capability: a registered
 * effective-rule builder, its base configuration, and a schema of named adjustable parameters.
 * An instance owns only its overrides (the `configurablePassive` trait); its ordinary
 * `passive.eventRules` are rebuilt from the validated effective configuration, so generic
 * scoring consumes them uniformly and never asks whether a passive is configurable.
 *
 * Shared definitions are never mutated and no definition is registered per setting. A
 * definition without the capability resolves through the registered `fixed` provider: it has
 * no adjustable parameters and its own rules.
 */
import { Registry } from "./core/registry";
import type { EventRule } from "./event-rules";
import { passiveDefinitions, type PassiveBlock, type PassiveDefinition } from "./passives";
import { rackTraitPersistence } from "./rack-trait-persistence";

/** The configuration descriptor's schema version: saved with it, and checked on restore. */
export const configurationSchemaVersion = 1;

/** One adjustable parameter: where it sits in the builder's configuration, and its range. */
export type ParameterSchema = {
  label: string;
  /** Its location in the base configuration: object keys and array indices. */
  path: readonly (string | number)[];
} & (
  | { kind: "number"; min: number; max: number; step?: number }
  | { kind: "choice"; options: readonly string[] }
);

/** The capability a definition declares to allow instance configuration. */
export type ConfigurableCapability = {
  /** A registered effective-rule builder (`passiveRuleBuilders`). */
  builder: string;
  /** The builder's base configuration, whose values are the parameters' defaults. */
  config: unknown;
  parameters: Readonly<Record<string, ParameterSchema>>;
};

/** An instance's configuration: the schema version and its overrides only. */
export type PassiveConfiguration = {
  schemaVersion: number;
  overrides: Readonly<Record<string, number | string>>;
};

/** Builds a definition's ordinary event rules from an effective configuration. */
export type PassiveRuleBuilder = {
  /** Everything wrong with the effective configuration as a whole (empty when it is valid). */
  validate(owner: string, config: unknown): string[];
  build(config: unknown, definition: PassiveDefinition): readonly EventRule[];
};
export const passiveRuleBuilders = new Registry<PassiveRuleBuilder>("passive rule builder");

// No capability: nothing to adjust; the definition's own rules.
passiveRuleBuilders.register("fixed", {
  validate: () => [],
  build: (_config, definition) => definition.eventRules,
});
const fixedCapability: ConfigurableCapability = { builder: "fixed", config: null, parameters: {} };

/** The capability a definition resolves to: its own, or the fixed one. */
const capabilityOf = (definition: PassiveDefinition) => definition.configurable ?? fixedCapability;

/** A copy of `value` with the entry at `path` replaced: never touching the original. */
function setAt(value: unknown, path: readonly (string | number)[], next: unknown): unknown {
  if (!path.length) return next;
  const [head, ...rest] = path;
  const copy = (Array.isArray(value) ? [...value] : { ...(value as object) }) as Record<
    string | number,
    unknown
  >;
  copy[head!] = setAt(copy[head!], rest, next);
  return copy;
}

const getAt = (value: unknown, path: readonly (string | number)[]): unknown =>
  path.reduce<unknown>(
    (current, key) => (current as Record<string | number, unknown>)?.[key],
    value,
  );

/** The configuration with these overrides applied at their declared paths. */
const effectiveConfig = (
  capability: ConfigurableCapability,
  overrides: PassiveConfiguration["overrides"],
) =>
  Object.entries(overrides).reduce(
    (config, [name, value]) => setAt(config, capability.parameters[name]!.path, value),
    capability.config,
  );

/** The definition's parameter defaults: the values at their paths in its base configuration. */
const defaultsOf = (capability: ConfigurableCapability) =>
  Object.fromEntries(
    Object.entries(capability.parameters).map(([name, schema]) => [
      name,
      getAt(capability.config, schema.path) as number | string,
    ]),
  );

/** Whether one parameter value fits its schema. */
const parameterProblems: Record<
  ParameterSchema["kind"],
  (name: string, schema: ParameterSchema, value: unknown) => string[]
> = {
  number: (name, schema, value) => {
    const { min, max } = schema as Extract<ParameterSchema, { kind: "number" }>;
    return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
      ? []
      : [`${name}: needs a number from ${min} to ${max}`];
  },
  choice: (name, schema, value) => {
    const { options } = schema as Extract<ParameterSchema, { kind: "choice" }>;
    return options.includes(value as string) ? [] : [`${name}: needs one of ${options.join(", ")}`];
  },
};

/** Everything wrong with a configuration for this definition (empty when it is valid). */
export function configurationProblems(
  definition: PassiveDefinition,
  configuration: PassiveConfiguration,
): string[] {
  if (configuration.schemaVersion !== configurationSchemaVersion)
    return [`${definition.id}: unsupported configuration version ${configuration.schemaVersion}`];
  const capability = capabilityOf(definition);
  const { parameters } = capability;
  const entries = Object.entries(configuration.overrides);
  const unknown = entries.filter(([name]) => !Object.hasOwn(parameters, name));
  if (unknown.length)
    return unknown.map(([name]) => `${definition.id}: unknown parameter "${name}"`);
  const invalid = entries.flatMap(([name, value]) =>
    parameterProblems[parameters[name]!.kind](name, parameters[name]!, value).map(
      (problem) => `${definition.id}: ${problem}`,
    ),
  );
  if (invalid.length) return invalid;
  // The combination as a whole, through the builder's own validation.
  return passiveRuleBuilders
    .get(capability.builder)
    .validate(definition.id, effectiveConfig(capability, configuration.overrides));
}

/** A configuration that can't be applied: the old instance is left as it was. */
export class PassiveConfigurationError extends Error {
  constructor(problems: readonly string[]) {
    super(problems.join("\n"));
    this.name = "PassiveConfigurationError";
  }
}

/**
 * This instance with these overrides: a new block whose rules are rebuilt from the validated
 * effective configuration. Throws, changing nothing, when the configuration is invalid.
 */
export function configurePassive(
  block: PassiveBlock,
  overrides: PassiveConfiguration["overrides"],
): PassiveBlock {
  const definition = passiveDefinitions.get(block.definitionId);
  const configuration = {
    schemaVersion: configurationSchemaVersion,
    overrides: Object.freeze({ ...overrides }),
  };
  const problems = configurationProblems(definition, configuration);
  if (problems.length) throw new PassiveConfigurationError(problems);
  return {
    ...block,
    traits: {
      ...block.traits,
      configurablePassive: Object.freeze(configuration),
      passive: {
        ...block.traits.passive!,
        eventRules: passiveRuleBuilders
          .get(capabilityOf(definition).builder)
          .build(effectiveConfig(capabilityOf(definition), configuration.overrides), definition),
      },
    },
  };
}

/** The instance's configuration: its own overrides, or none. */
export const passiveConfiguration = (block: PassiveBlock): PassiveConfiguration =>
  block.traits.configurablePassive ?? { schemaVersion: configurationSchemaVersion, overrides: {} };

/** One adjustable setting as inspection and controls show it. */
export type EffectiveSetting = {
  name: string;
  schema: ParameterSchema;
  value: number | string;
  defaultValue: number | string;
  overridden: boolean;
};

/** The instance's effective settings, from its definition's schema (empty when not configurable). */
export function effectiveSettings(block: PassiveBlock): EffectiveSetting[] {
  const definition = passiveDefinitions.get(block.definitionId);
  const capability = capabilityOf(definition);
  const defaults = defaultsOf(capability);
  const { overrides } = passiveConfiguration(block);
  return Object.entries(capability.parameters).map(([name, schema]) => ({
    name,
    schema,
    value: overrides[name] ?? defaults[name]!,
    defaultValue: defaults[name]!,
    overridden: Object.hasOwn(overrides, name),
  }));
}

/** An exact clone's configuration: the same overrides, as an independent copy. */
export const clonePassiveConfiguration = (from: PassiveBlock, to: PassiveBlock): PassiveBlock =>
  configurePassive(to, { ...passiveConfiguration(from).overrides });

/** The instance reset to its definition's declared baseline: no overrides. */
export const resetPassiveConfiguration = (block: PassiveBlock): PassiveBlock =>
  configurePassive(block, {});

// Saved as its version and overrides only; the rules are rebuilt through validation on restore.
rackTraitPersistence.register("configurablePassive", {
  save: (value) => {
    const { schemaVersion, overrides } = value as PassiveConfiguration;
    return { schemaVersion, overrides: { ...overrides } };
  },
  restore: (saved) => {
    const { schemaVersion, overrides } = (saved ?? {}) as Partial<PassiveConfiguration>;
    if (schemaVersion !== configurationSchemaVersion)
      throw new Error(`unsupported passive configuration version ${String(schemaVersion)}`);
    if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides))
      throw new Error("bad passive configuration overrides");
    return { schemaVersion, overrides: { ...overrides } };
  },
  attach: (block, restored) =>
    configurePassive(block, (restored as PassiveConfiguration).overrides),
});
