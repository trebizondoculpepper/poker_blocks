/**
 * Interchangeable crystal looks (#523): each backend names the appearance assembly that draws a
 * crystal-compatible block, so a tool can rebuild the same block with another look by
 * configuration alone, never by branching on a material's name. The game itself is unchanged:
 * a material still picks its look by its own `appearance.assembly`.
 */
import { Registry } from "../core/registry";
import type { MaterialDefinition } from "../materials";
import { crystalV3Tuning } from "./crystal-v3";
import { refractionFrame, refractionTuning } from "./crystal-refraction";
import type * as THREE from "three";

/** A live tuning control a comparison tool may show for a backend: one shared uniform. */
export type OpticsControl = {
  label: string;
  min: number;
  max: number;
  step: number;
  uniform: { value: number };
};

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
    { label: "Spectral strength", min: 0, max: 1, step: 0.05, uniform: crystalV3Tuning.spectral },
    {
      label: "Front intensity",
      min: 0,
      max: 2,
      step: 0.05,
      uniform: crystalV3Tuning.frontIntensity,
    },
    { label: "Rear intensity", min: 0, max: 2, step: 0.05, uniform: crystalV3Tuning.rearIntensity },
    { label: "Front offset", min: 0, max: 1, step: 0.05, uniform: crystalV3Tuning.frontOffset },
    { label: "Rear offset", min: 0, max: 1.5, step: 0.05, uniform: crystalV3Tuning.rearOffset },
    { label: "Rear opacity", min: 0, max: 1, step: 0.05, uniform: crystalV3Tuning.rearOpacity },
    { label: "Fresnel base", min: 0, max: 1, step: 0.02, uniform: crystalV3Tuning.fresnelBase },
    { label: "Fresnel power", min: 0.5, max: 8, step: 0.25, uniform: crystalV3Tuning.fresnelPower },
  ],
});

opticsBackends.register("refraction", {
  label: "Refraction (prototype)",
  assembly: "crystalRefraction",
  unsupported:
    "Prototype: background bent per facet from a shared capture. Crystals do not refract each other, overlapping blocks take the nearest rear facet's bend, and the hand has nothing captured behind it.",
  frame: refractionFrame,
  controls: [
    { label: "Rear bend", min: 0, max: 0.2, step: 0.005, uniform: refractionTuning.rearStrength },
    { label: "Front bend", min: 0, max: 0.2, step: 0.005, uniform: refractionTuning.frontStrength },
    { label: "Magnify", min: 0, max: 0.6, step: 0.01, uniform: refractionTuning.magnify },
    { label: "Colour split", min: 0, max: 0.5, step: 0.01, uniform: refractionTuning.dispersion },
    { label: "Reflection base", min: 0, max: 1, step: 0.02, uniform: refractionTuning.fresnelBase },
    {
      label: "Reflection power",
      min: 0.5,
      max: 8,
      step: 0.25,
      uniform: refractionTuning.fresnelPower,
    },
    { label: "Spectral", min: 0, max: 1, step: 0.05, uniform: refractionTuning.spectral },
    { label: "Reflection", min: 0, max: 1.5, step: 0.05, uniform: refractionTuning.reflection },
    { label: "Clarity", min: 0.5, max: 1, step: 0.02, uniform: refractionTuning.clarity },
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
