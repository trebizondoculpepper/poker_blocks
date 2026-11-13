/**
 * Interchangeable crystal looks (#523): each backend names the appearance assembly that draws a
 * crystal-compatible block, so a tool can rebuild the same block with another look by
 * configuration alone, never by branching on a material's name. The game itself is unchanged:
 * a material still picks its look by its own `appearance.assembly`.
 *
 * Copy settings (#677): a preset's `config` keys are the fields of each look's tuning object
 * (`crystalV3Tuning` in `crystal-v3.ts`, a refraction preset's settings in `crystal-refraction.ts`
 * such as `crystalRefractionSettings`, `internalTuning` in `crystal-internal.ts`), plus its
 * ripple's `rippleAmplitude`, `ripplePeriod` and `rippleScale` where it has one, plus `mapPattern` and `mapFrequency` for the shared
 * spectral map (`spectralShape`, `setSpectralShape`). To adopt a copied preset, set each field's
 * `value` (or the map shape) to its value; `applyOptics(preset)` does the same at runtime.
 */
import { Registry } from "../core/registry";
import type { MaterialDefinition } from "../materials";
import { crystalV3Tuning, setSpectralShape, spectralPatterns, spectralShape } from "./crystal-v3";
import { createRefractionCapture, refractionPresets } from "./crystal-refraction";
import type { RenderPass } from "./render-pass";
import { rippleBounds, type LookupRipple } from "./lookup-ripple";
import { createInternalCapture, internalTuning } from "./crystal-internal";

/**
 * A live tuning control a comparison tool may show for a backend. Its `key` is the stable field
 * name a copied preset uses (#677; doc/refractive-water-prototypes.md, "Copy settings"): labels
 * are presentation only and never persistence keys. `fallback` is its default.
 */
export type OpticsControl =
  | {
      key: string;
      label: string;
      min: number;
      max: number;
      step: number;
      fallback: number;
      value(): number;
      set(value: number): void;
      /**
       * Bring a well-formed imported value within bounds, with a notice saying so (#795): an old
       * preset's value from before the bounds changed. Omitted, out-of-range values are refused.
       */
      normalize?(value: number): { value: number; notice?: string } | null;
    }
  | {
      key: string;
      label: string;
      options: readonly string[];
      fallback: string;
      value(): string;
      set(value: string): void;
    };

/** A slider bound to one shared uniform. */
const slider = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  uniform: { value: number },
): OpticsControl => ({
  key,
  label,
  min,
  max,
  step,
  // Its value as the module set it up: the default a preset falls back to.
  fallback: uniform.value,
  value: () => uniform.value,
  set: (value: number) => void (uniform.value = value),
});

/** The shared spectral map's shape, offered by every look that reads it. */
const mapControls: readonly OpticsControl[] = [
  {
    key: "mapPattern",
    label: "Map pattern",
    options: Object.keys(spectralPatterns),
    fallback: spectralShape.pattern,
    value: () => spectralShape.pattern,
    set: (pattern: string) => setSpectralShape({ pattern }),
  },
  {
    key: "mapFrequency",
    label: "Map frequency",
    fallback: spectralShape.frequency,
    min: 1,
    max: 16,
    step: 1,
    value: () => spectralShape.frequency,
    set: (frequency: number) => setSpectralShape({ frequency }),
  },
];

/** A refraction preset's live controls: its own uniforms, so presets never share tuning. */
const refractionControls = (preset: string): readonly OpticsControl[] => {
  const { tuning } = refractionPresets.get(preset);
  return [
    slider("rearStrength", "Rear bend", 0, 0.2, 0.005, tuning.rearStrength),
    slider("frontStrength", "Front bend", 0, 0.2, 0.005, tuning.frontStrength),
    slider("magnify", "Magnify", 0, 0.6, 0.01, tuning.magnify),
    slider("dispersion", "Colour split", 0, 0.5, 0.01, tuning.dispersion),
    slider("fresnelBase", "Reflection base", 0, 1, 0.02, tuning.fresnelBase),
    slider("fresnelPower", "Reflection power", 0.5, 8, 0.25, tuning.fresnelPower),
    slider("spectral", "Spectral", 0, 1, 0.05, tuning.spectral),
    slider("reflection", "Reflection", 0, 1.5, 0.05, tuning.reflection),
    slider("clarity", "Clarity", 0.5, 1, 0.02, tuning.clarity),
    ...rippleControls(refractionPresets.get(preset).ripple),
  ];
};

/** A lookup ripple's settings (#674): strength, loop length and spatial scale. */
const rippleControls = (ripple: LookupRipple): readonly OpticsControl[] => [
  slider(
    "rippleAmplitude",
    "Ripple strength",
    rippleBounds.amplitude.min,
    rippleBounds.amplitude.max,
    0.001,
    ripple.amplitude,
  ),
  {
    // This ripple's own period bounds (#795): the same ones its clock runs within.
    ...slider(
      "ripplePeriod",
      "Ripple period (s)",
      ripple.periodBounds.min,
      ripple.periodBounds.max,
      ripple.periodBounds.step,
      ripple.period,
    ),
    normalize: (value: number) => {
      if (!Number.isFinite(value) || value <= 0) return null;
      const { min, max } = ripple.periodBounds;
      const clamped = Math.min(max, Math.max(min, value));
      return clamped === value
        ? { value }
        : { value: clamped, notice: `ripplePeriod ${value} s adjusted to ${clamped} s` };
    },
  },
  slider(
    "rippleScale",
    "Ripple scale",
    rippleBounds.scale.min,
    rippleBounds.scale.max,
    0.1,
    ripple.scale,
  ),
];

export type OpticsBackend = {
  /** Shown in comparison tools. */
  label: string;
  /** The registered appearance assembly that draws this look. */
  assembly: string;
  /**
   * Further appearance data this look sets on the block's definition, such as the refraction
   * preset it draws with (#674): configuration, read uniformly by the assembly.
   */
  appearance?: Partial<MaterialDefinition["appearance"]>;
  /** Compositions this look cannot show faithfully, said rather than drawn wrong. */
  unsupported?: string;
  /** Live tuning this look offers, as data: a tool shows whichever controls a backend lists. */
  controls?: readonly OpticsControl[];
  /**
   * Make the passes this look needs each frame before the main render (a background capture).
   * Whoever draws the look creates one per renderer, runs it each frame with the presentation
   * time since the last frame, and disposes it when done (doc/profiler-render-passes.md).
   */
  capture?: () => RenderPass;
};

export const opticsBackends = new Registry<OpticsBackend>("optics backend");
opticsBackends.register("current", { label: "Current", assembly: "refractiveCrystal" });
opticsBackends.register("approximation", {
  label: "Approximation",
  assembly: "approximateCrystal",
  unsupported:
    "Contained blocks and glass panes are not approximated, and nothing behind a block is bent or split into colours; it shows crystal blocks only.",
});

/** The same definition drawn through another backend: only its assembly changes. */
opticsBackends.register("crystalV3", {
  label: "Crystal v3",
  assembly: "crystalV3",
  unsupported:
    "Clean faces with two mapped layers: the front blends over the rear but does not refract it, nothing behind a block is bent, and overlapping blocks are not sorted face by face.",
  controls: [
    ...mapControls,
    slider("spectral", "Spectral strength", 0, 1, 0.05, crystalV3Tuning.spectral),
    slider("frontIntensity", "Front intensity", 0, 2, 0.05, crystalV3Tuning.frontIntensity),
    slider("rearIntensity", "Rear intensity", 0, 2, 0.05, crystalV3Tuning.rearIntensity),
    slider("frontOffset", "Front offset", 0, 1, 0.05, crystalV3Tuning.frontOffset),
    slider("rearOffset", "Rear offset", 0, 1.5, 0.05, crystalV3Tuning.rearOffset),
    slider("rearOpacity", "Rear opacity", 0, 1, 0.05, crystalV3Tuning.rearOpacity),
    slider("fresnelBase", "Fresnel base", 0, 1, 0.02, crystalV3Tuning.fresnelBase),
    slider("fresnelPower", "Fresnel power", 0.5, 8, 0.25, crystalV3Tuning.fresnelPower),
  ],
});

opticsBackends.register("refraction", {
  label: "Refraction (prototype)",
  assembly: "crystalRefraction",
  unsupported:
    "Prototype: background bent per facet from a shared capture. Crystals do not refract each other, overlapping blocks take the nearest rear facet's bend, and the hand has nothing captured behind it.",
  appearance: { refraction: "crystal" },
  capture: () => createRefractionCapture("crystal"),
  controls: [...mapControls, ...refractionControls("crystal")],
});

/**
 * Calm water (prototype, #675): the refraction backend's assembly and passes with the calm-water
 * preset's own settings, ripple and sky. It reads no spectral map, so offers no map controls.
 */
opticsBackends.register("calmWater", {
  label: "Calm water (prototype)",
  assembly: "crystalRefraction",
  unsupported:
    "Prototype: the Refraction look, gentler, with a slow ripple in what is seen through it. Blocks do not refract each other, overlapping blocks take the nearest rear facet's bend, and the hand has nothing captured behind it.",
  appearance: { refraction: "calmWater" },
  capture: () => createRefractionCapture("calmWater"),
  controls: refractionControls("calmWater"),
});

opticsBackends.register("internal", {
  label: "Internal (prototype)",
  assembly: "crystalInternal",
  unsupported:
    "Prototype: ignores the background. Back facets show the rainbow map reflected inside the crystal; front facets distort that by how far their outer and inner rays part. Overlapping blocks share one inner image, nearest facet first.",
  capture: createInternalCapture,
  controls: [
    ...mapControls,
    slider("distortion", "Distortion", 0, 0.4, 0.01, internalTuning.distortion),
    slider("normalShift", "Normal shift", 0, 0.2, 0.005, internalTuning.normalShift),
    slider("ior", "Index of refraction", 1.1, 2.6, 0.05, internalTuning.ior),
    slider("inner", "Inner brightness", 0, 2, 0.05, internalTuning.inner),
    slider("outer", "Outer brightness", 0, 2, 0.05, internalTuning.outer),
    slider("dispersion", "Colour split", 0, 0.5, 0.01, internalTuning.dispersion),
    slider("fresnelBase", "Reflection base", 0, 1, 0.02, internalTuning.fresnelBase),
    slider("fresnelPower", "Reflection power", 0.5, 8, 0.25, internalTuning.fresnelPower),
    slider("spectral", "Spectral", 0, 1, 0.05, internalTuning.spectral),
  ],
});

export function withOpticsBackend(
  definition: MaterialDefinition,
  backend: string,
): MaterialDefinition {
  const { assembly, appearance } = opticsBackends.get(backend);
  return { ...definition, appearance: { ...definition.appearance, ...appearance, assembly } };
}

/** A copied preset: a backend's complete effective settings, versioned (#677). */
export type OpticsPreset = {
  schemaVersion: 1;
  backend: string;
  config: Record<string, number | string>;
};

/**
 * A backend's complete effective settings: every control's current value under its stable key,
 * defaults included. A backend without controls has nothing configurable, so its preset is a
 * valid empty config. Dispatched through the registry; no backend is named.
 */
export function snapshotOptics(backend: string): OpticsPreset {
  const controls = opticsBackends.get(backend).controls ?? [];
  return {
    schemaVersion: 1,
    backend,
    config: Object.fromEntries(controls.map((control) => [control.key, control.value()])),
  };
}

/** Check one value against its control; the reason it is refused, or null. */
function refusal(control: OpticsControl, value: unknown): string | null {
  if ("options" in control)
    return typeof value === "string" && control.options.includes(value)
      ? null
      : `${control.key} must be one of ${control.options.join(", ")}`;
  return typeof value === "number" && value >= control.min && value <= control.max
    ? null
    : `${control.key} must be a number from ${control.min} to ${control.max}`;
}

/**
 * Apply a copied preset through its backend's registration: every control takes the preset's
 * value, or its default when the preset omits it. Unknown backends or fields, a wrong schema
 * version, or an invalid value are refused before anything changes.
 */
export function applyOptics(preset: unknown): string[] {
  const { schemaVersion, backend, config } = (preset ?? {}) as Partial<OpticsPreset>;
  if (schemaVersion !== 1) throw new Error("Unsupported optics preset version");
  if (typeof backend !== "string" || !opticsBackends.has(backend))
    throw new Error("Unknown optics backend");
  const controls = opticsBackends.get(backend).controls ?? [];
  // Well-formed values a control normalizes come within its bounds, each with a notice (#795).
  const notices: string[] = [];
  const values = Object.fromEntries(
    Object.entries((config ?? {}) as Record<string, unknown>).map(([key, value]) => {
      const control = controls.find((candidate) => candidate.key === key);
      const normalized =
        control && "normalize" in control && control.normalize && typeof value === "number"
          ? control.normalize(value)
          : null;
      if (normalized?.notice) notices.push(normalized.notice);
      return [key, normalized ? normalized.value : value];
    }),
  );
  const known = new Set(controls.map(({ key }) => key));
  const unknown = Object.keys(values).filter((key) => !known.has(key));
  if (unknown.length) throw new Error(`Unknown optics settings: ${unknown.join(", ")}`);
  const problems = controls.flatMap((control) => {
    const why = control.key in values ? refusal(control, values[control.key]) : null;
    return why ? [why] : [];
  });
  if (problems.length) throw new Error(problems.join("; "));
  for (const control of controls) {
    const value = control.key in values ? values[control.key] : control.fallback;
    (control.set as (value: number | string) => void)(value as number | string);
  }
  return notices;
}
