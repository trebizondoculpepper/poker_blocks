/**
 * Interchangeable crystal looks (#523): each backend names the appearance assembly that draws a
 * crystal-compatible block, so a tool can rebuild the same block with another look by
 * configuration alone, never by branching on a material's name. The game itself is unchanged:
 * a material still picks its look by its own `appearance.assembly`.
 */
import { Registry } from "../core/registry";
import type { MaterialDefinition } from "../materials";
import { crystalV3Tuning, setSpectralShape, spectralPatterns, spectralShape } from "./crystal-v3";
import { refractionFrame, refractionTuning } from "./crystal-refraction";
import { internalFrame, internalTuning } from "./crystal-internal";
import type * as THREE from "three";

/** A live tuning control a comparison tool may show for a backend. */
export type OpticsControl =
  | {
      label: string;
      min: number;
      max: number;
      step: number;
      value(): number;
      set(value: number): void;
    }
  | { label: string; options: readonly string[]; value(): string; set(value: string): void };

/** A slider bound to one shared uniform. */
const slider = (
  label: string,
  min: number,
  max: number,
  step: number,
  uniform: { value: number },
): OpticsControl => ({
  label,
  min,
  max,
  step,
  value: () => uniform.value,
  set: (value: number) => void (uniform.value = value),
});

/** The shared spectral map's shape, offered by every look that reads it. */
const mapControls: readonly OpticsControl[] = [
  {
    label: "Map pattern",
    options: Object.keys(spectralPatterns),
    value: () => spectralShape.pattern,
    set: (pattern: string) => setSpectralShape({ pattern }),
  },
  {
    label: "Map frequency",
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
    slider("Spectral strength", 0, 1, 0.05, crystalV3Tuning.spectral),
    slider("Front intensity", 0, 2, 0.05, crystalV3Tuning.frontIntensity),
    slider("Rear intensity", 0, 2, 0.05, crystalV3Tuning.rearIntensity),
    slider("Front offset", 0, 1, 0.05, crystalV3Tuning.frontOffset),
    slider("Rear offset", 0, 1.5, 0.05, crystalV3Tuning.rearOffset),
    slider("Rear opacity", 0, 1, 0.05, crystalV3Tuning.rearOpacity),
    slider("Fresnel base", 0, 1, 0.02, crystalV3Tuning.fresnelBase),
    slider("Fresnel power", 0.5, 8, 0.25, crystalV3Tuning.fresnelPower),
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
    slider("Rear bend", 0, 0.2, 0.005, refractionTuning.rearStrength),
    slider("Front bend", 0, 0.2, 0.005, refractionTuning.frontStrength),
    slider("Magnify", 0, 0.6, 0.01, refractionTuning.magnify),
    slider("Colour split", 0, 0.5, 0.01, refractionTuning.dispersion),
    slider("Reflection base", 0, 1, 0.02, refractionTuning.fresnelBase),
    slider("Reflection power", 0.5, 8, 0.25, refractionTuning.fresnelPower),
    slider("Spectral", 0, 1, 0.05, refractionTuning.spectral),
    slider("Reflection", 0, 1.5, 0.05, refractionTuning.reflection),
    slider("Clarity", 0.5, 1, 0.02, refractionTuning.clarity),
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
    slider("Distortion", 0, 0.4, 0.01, internalTuning.distortion),
    slider("Normal shift", 0, 0.2, 0.005, internalTuning.normalShift),
    slider("Index of refraction", 1.1, 2.6, 0.05, internalTuning.ior),
    slider("Inner brightness", 0, 2, 0.05, internalTuning.inner),
    slider("Outer brightness", 0, 2, 0.05, internalTuning.outer),
    slider("Colour split", 0, 0.5, 0.01, internalTuning.dispersion),
    slider("Reflection base", 0, 1, 0.02, internalTuning.fresnelBase),
    slider("Reflection power", 0.5, 8, 0.25, internalTuning.fresnelPower),
    slider("Spectral", 0, 1, 0.05, internalTuning.spectral),
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
