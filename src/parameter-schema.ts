/**
 * Adjustable parameters described as data (#876, #1024): a named parameter's location in a plain
 * configuration and its finite range. Anything that lets a person tune a configuration (a
 * configurable passive, doc/experiments/passive-test-bench.md; a tunable visual effect,
 * doc/audition-followups.md, "Flame Bench") declares its parameters this way, so validation,
 * defaults and controls come from one capability rather than one per kind of thing.
 *
 * Everything here is pure: configurations are copied, never mutated.
 */

/** One adjustable parameter: where it sits in a configuration, and its range. */
export type ParameterSchema = {
  label: string;
  /** Its location in the configuration: object keys and array indices. */
  path: readonly (string | number)[];
} & (
  | { kind: "number"; min: number; max: number; step?: number }
  | { kind: "choice"; options: readonly string[] }
);

/** A value one parameter can take. */
export type ParameterValue = number | string;

/** Named parameters, as a definition declares them. */
export type ParameterSchemas = Readonly<Record<string, ParameterSchema>>;

/**
 * A copy of `value` with the entry at `path` replaced: never touching the original. A missing
 * step is created as an array when its key is an index, otherwise as an object.
 */
export function setAt(value: unknown, path: readonly (string | number)[], next: unknown): unknown {
  if (!path.length) return next;
  const [head, ...rest] = path;
  const base = value ?? (typeof head === "number" ? [] : {});
  const copy = (Array.isArray(base) ? [...base] : { ...(base as object) }) as Record<
    string | number,
    unknown
  >;
  copy[head!] = setAt(copy[head!], rest, next);
  return copy;
}

/** The entry at `path`, or undefined where the path doesn't reach. */
export const getAt = (value: unknown, path: readonly (string | number)[]): unknown =>
  path.reduce<unknown>(
    (current, key) => (current as Record<string | number, unknown> | undefined)?.[key],
    value,
  );

/** The configuration with these named values written at their declared paths. */
export const withParameters = (
  parameters: ParameterSchemas,
  config: unknown,
  values: Readonly<Record<string, ParameterValue>>,
): unknown =>
  Object.entries(values).reduce(
    (current, [name, value]) => setAt(current, parameters[name]!.path, value),
    config,
  );

/** Each parameter's value in this configuration (undefined where it has none). */
export const parameterValues = (
  parameters: ParameterSchemas,
  config: unknown,
): Record<string, ParameterValue> =>
  Object.fromEntries(
    Object.entries(parameters).map(([name, schema]) => [
      name,
      getAt(config, schema.path) as ParameterValue,
    ]),
  );

/** Whether one value fits its parameter's schema, by the schema's own kind. */
const valueProblems: Record<
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

/**
 * Everything wrong with these named values (empty when they are valid): unknown names are
 * reported, never silently dropped; each known value is checked against its schema.
 */
export function parameterProblems(
  parameters: ParameterSchemas,
  values: Readonly<Record<string, unknown>>,
): string[] {
  const entries = Object.entries(values);
  const unknown = entries.filter(([name]) => !Object.hasOwn(parameters, name));
  if (unknown.length) return unknown.map(([name]) => `unknown parameter "${name}"`);
  return entries.flatMap(([name, value]) =>
    valueProblems[parameters[name]!.kind](name, parameters[name]!, value),
  );
}
