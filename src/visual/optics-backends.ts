/**
 * Interchangeable crystal looks (#523): each backend names the appearance assembly that draws a
 * crystal-compatible block, so a tool can rebuild the same block with another look by
 * configuration alone, never by branching on a material's name. The game itself is unchanged:
 * a material still picks its look by its own `appearance.assembly`.
 *
 * Copy settings (#677): a preset's `config` keys are the fields of each look's tuning object
 * (`crystalV3Tuning` in `crystal-v3.ts`, `refractionTuning` in `crystal-refraction.ts`,
 * `internalTuning` in `crystal-internal.ts`), plus `mapPattern` and `mapFrequency` for the shared
 * spectral map (`spectralShape`, `setSpectralShape`). To adopt a copied preset, set each field's
 * `value` (or the map shape) to its value; `applyOptics(preset)` does the same at runtime.
 */
import { Registry } from "../core/registry";
import type { MaterialDefinition } from "../materials";
import { crystalV3Tuning, setSpectralShape, spectralPatterns, spectralShape } from "./crystal-v3";
import { refractionFrame, refractionTuning } from "./crystal-refraction";
import { internalFrame, internalTuning } from "./crystal-internal";
import type * as THREE from "three";

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

export type OpticsBackend = {
  /** Shown in comparison tools. */
  label: string;
  /** The registered appearance assembly that draws this look. */
  assembly: string;
  /** Compositions this look cannot show faithfully, said rather than drawn wrong. */
  unsupported?: string;
  /** Live tuning this look offers, as data: a tool shows whichever controls a backend lists. */
  controls?: readonly OpticsControl[];
  /**
   * Passes this look needs each frame before the main render (a background capture), run by the
   * tool that draws it; `hide` holds the blocks drawn with this look.
   */
  frame?: (context: {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.Camera;
    hide: THREE.Object3D;
  }) => void;
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
  frame: refractionFrame,
  controls: [
    ...mapControls,
    slider("rearStrength", "Rear bend", 0, 0.2, 0.005, refractionTuning.rearStrength),
    slider("frontStrength", "Front bend", 0, 0.2, 0.005, refractionTuning.frontStrength),
    slider("magnify", "Magnify", 0, 0.6, 0.01, refractionTuning.magnify),
    slider("dispersion", "Colour split", 0, 0.5, 0.01, refractionTuning.dispersion),
    slider("fresnelBase", "Reflection base", 0, 1, 0.02, refractionTuning.fresnelBase),
    slider("fresnelPower", "Reflection power", 0.5, 8, 0.25, refractionTuning.fresnelPower),
    slider("spectral", "Spectral", 0, 1, 0.05, refractionTuning.spectral),
    slider("reflection", "Reflection", 0, 1.5, 0.05, refractionTuning.reflection),
    slider("clarity", "Clarity", 0.5, 1, 0.02, refractionTuning.clarity),
  ],
});

opticsBackends.register("internal", {
  label: "Internal (prototype)",
  assembly: "crystalInternal",
  unsupported:
    "Prototype: ignores the background. Back facets show the rainbow map reflected inside the crystal; front facets distort that by how far their outer and inner rays part. Overlapping blocks share one inner image, nearest facet first.",
  frame: internalFrame,
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
  return {
    ...definition,
    appearance: { ...definition.appearance, assembly: opticsBackends.get(backend).assembly },
  };
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
export function applyOptics(preset: unknown): void {
  const { schemaVersion, backend, config } = (preset ?? {}) as Partial<OpticsPreset>;
  if (schemaVersion !== 1) throw new Error("Unsupported optics preset version");
  if (typeof backend !== "string" || !opticsBackends.has(backend))
    throw new Error("Unknown optics backend");
  const controls = opticsBackends.get(backend).controls ?? [];
  const values = (config ?? {}) as Record<string, unknown>;
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
}
