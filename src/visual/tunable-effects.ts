/**
 * Tunable visual effects (#1024; doc/audition-followups.md, "Flame Bench"): the reusable
 * parameter, preset and export capability a bench composes. An effect that can be tuned
 * registers its own parameter descriptors (finite ranges, `src/parameter-schema.ts`) and its full
 * default configuration beside its handler; nothing here knows which effect it holds.
 *
 * A **preset** is plain data: a handle (what it was taken from, such as a material id; display and
 * export only, never behaviour) and that effect's configuration. A **tuning** is one preview's
 * own state: the preset's frozen baseline and this preview's edits. Edits never touch the preset,
 * the production definition it came from, or another tuning. Its `config()` is the effective
 * configuration the real effect handler builds from; the room rebuilds through that handler, so
 * no preview has a separate simulation or shader.
 *
 * Copy Settings emits a versioned plain record: the effect, the preset handle and every effective
 * parameter value. No meshes, uniforms, clock phase or live handles. Applying a record validates
 * it through the same descriptors; unknown parameters are reported, never silently dropped.
 */
import { Registry } from "../core/registry";
import {
  parameterProblems,
  parameterValues,
  withParameters,
  type ParameterSchemas,
  type ParameterValue,
} from "../parameter-schema";

/** What an effect registers to be tunable: its descriptors and its complete defaults. */
export type TunableEffect = {
  parameters: ParameterSchemas;
  /** The configuration the effect uses when given none; every parameter has a value here. */
  defaults: unknown;
};

/** Tunable effects, by the same name their handler is registered under. */
export const tunableEffects = new Registry<TunableEffect>("tunable effect");

/** A configuration to tune from: an effect, its configuration and where it came from. */
export type EffectPreset = { handle: string; effect: string; config: unknown };

export const effectSettingsFormat = "poker-blocks.effect-settings";
export const effectSettingsVersion = 1;

/** The Copy Settings record: plain, versioned, every effective parameter value. */
export type EffectSettings = {
  format: typeof effectSettingsFormat;
  version: typeof effectSettingsVersion;
  effect: string;
  preset: string;
  parameters: Record<string, ParameterValue>;
};

/** One preview's tuning of one preset. */
export type EffectTuning = {
  readonly preset: EffectPreset;
  readonly parameters: ParameterSchemas;
  /** The preset's own values: what a reset returns to. */
  baseline(): Record<string, ParameterValue>;
  /** The effective values: the baseline with this preview's edits. */
  values(): Record<string, ParameterValue>;
  /** Change one value; returns the problems and changes nothing when it is invalid. */
  set(name: string, value: unknown): string[];
  /** Drop every edit. */
  reset(): void;
  /** The effective configuration, a fresh copy, for the effect's own handler. */
  config(): unknown;
  /** The Copy Settings record. */
  settings(): EffectSettings;
  /** Apply a record; returns the problems and changes nothing when it is invalid. */
  apply(settings: EffectSettings): string[];
};

/** A deep, frozen copy: a preset can never be changed through a tuning. */
function frozenCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (typeof item !== "object" || item === null) return;
    Object.values(item).forEach(freeze);
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
}

/** The preset's value for each parameter, falling back to the effect's own default. */
function baselineOf(effect: TunableEffect, config: unknown): Record<string, ParameterValue> {
  const own = parameterValues(effect.parameters, config);
  const defaults = parameterValues(effect.parameters, effect.defaults);
  return Object.fromEntries(
    Object.keys(effect.parameters).map((name) => [name, own[name] ?? defaults[name]!]),
  );
}

/**
 * A tuning of this preset. Throws when the effect isn't tunable or the preset's own values fall
 * outside its descriptors (a range that doesn't cover production is a descriptor bug).
 */
export function createEffectTuning(preset: EffectPreset): EffectTuning {
  const effect = tunableEffects.get(preset.effect);
  const own = frozenCopy(preset);
  const baseline = Object.freeze(baselineOf(effect, own.config));
  const problems = parameterProblems(effect.parameters, baseline);
  if (problems.length)
    throw new Error(`Preset "${own.handle}" is outside its descriptors: ${problems.join("; ")}`);
  let edits: Record<string, ParameterValue> = {};
  const values = () => ({ ...baseline, ...edits });
  return {
    preset: own,
    parameters: effect.parameters,
    baseline: () => ({ ...baseline }),
    values,
    set(name, value) {
      const problems = parameterProblems(effect.parameters, { [name]: value });
      if (!problems.length) edits = { ...edits, [name]: value as ParameterValue };
      return problems;
    },
    reset() {
      edits = {};
    },
    config: () => withParameters(effect.parameters, structuredClone(own.config) ?? {}, values()),
    settings: () => ({
      format: effectSettingsFormat,
      version: effectSettingsVersion,
      effect: own.effect,
      preset: own.handle,
      parameters: values(),
    }),
    apply(settings) {
      if (settings.effect !== own.effect)
        return [`settings are for "${settings.effect}", not "${own.effect}"`];
      const problems = parameterProblems(effect.parameters, settings.parameters);
      // A record missing a parameter leaves it at the preset's own value.
      if (!problems.length) edits = { ...settings.parameters };
      return problems;
    },
  };
}

/** The record as text: what Copy Settings puts on the clipboard. */
export const serializeEffectSettings = (settings: EffectSettings): string =>
  JSON.stringify(settings, null, 2);

/** A pasted value as text for a diagnostic, never through its own (untrusted) conversion. */
const describe = (value: unknown): string => JSON.stringify(value) ?? typeof value;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Parse pasted settings. Checks the format, version, effect and every parameter against the
 * effect's descriptors; anything wrong comes back as problems, with no settings.
 */
export function parseEffectSettings(
  text: string,
): { settings: EffectSettings; problems: [] } | { settings: null; problems: string[] } {
  const fail = (...problems: string[]) => ({ settings: null, problems });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("not JSON");
  }
  if (!isRecord(raw)) return fail("not a settings record");
  if (raw.format !== effectSettingsFormat) return fail(`unknown format ${describe(raw.format)}`);
  if (raw.version !== effectSettingsVersion)
    return fail(`unsupported version ${describe(raw.version)}`);
  if (typeof raw.effect !== "string" || !tunableEffects.has(raw.effect))
    return fail(`unknown effect ${describe(raw.effect)}`);
  if (typeof raw.preset !== "string") return fail("missing preset handle");
  if (!isRecord(raw.parameters)) return fail("missing parameters");
  const problems = parameterProblems(tunableEffects.get(raw.effect).parameters, raw.parameters);
  if (problems.length) return fail(...problems);
  return { settings: raw as EffectSettings, problems: [] };
}

/** What Copy Settings did: copied, or the text to show for selecting by hand, and why. */
export type CopyResult =
  | { copied: true; text: string }
  | { copied: false; text: string; reason: string };

/**
 * Copy the record to the clipboard. A missing or refusing clipboard is an explicit result with
 * the text, so the bench can show it selectable instead.
 */
export async function copyEffectSettings(
  settings: EffectSettings,
  clipboard: Pick<Clipboard, "writeText"> | undefined = globalThis.navigator?.clipboard,
): Promise<CopyResult> {
  const text = serializeEffectSettings(settings);
  if (!clipboard) return { copied: false, text, reason: "no clipboard available" };
  try {
    await clipboard.writeText(text);
    return { copied: true, text };
  } catch (error) {
    return { copied: false, text, reason: error instanceof Error ? error.message : String(error) };
  }
}
