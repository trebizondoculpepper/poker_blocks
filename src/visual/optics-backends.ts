/**
 * Interchangeable crystal looks (#523): each backend names the appearance assembly that draws a
 * crystal-compatible block, so a tool can rebuild the same block with another look by
 * configuration alone, never by branching on a material's name. The game itself is unchanged:
 * a material still picks its look by its own `appearance.assembly`.
 */
import { Registry } from "../core/registry";
import type { MaterialDefinition } from "../materials";
import { crystalV3Tuning } from "./crystal-v3";

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

export function withOpticsBackend(
  definition: MaterialDefinition,
  backend: string,
): MaterialDefinition {
  return {
    ...definition,
    appearance: { ...definition.appearance, assembly: opticsBackends.get(backend).assembly },
  };
}
