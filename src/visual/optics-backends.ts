/**
 * Interchangeable crystal looks (#523): each backend names the appearance assembly that draws a
 * crystal-compatible block, so a tool can rebuild the same block with another look by
 * configuration alone, never by branching on a material's name. The game itself is unchanged:
 * a material still picks its look by its own `appearance.assembly`.
 */
import { Registry } from "../core/registry";
import type { MaterialDefinition } from "../materials";

export type OpticsBackend = {
  /** Shown in comparison tools. */
  label: string;
  /** The registered appearance assembly that draws this look. */
  assembly: string;
  /** Compositions this look cannot show faithfully, said rather than drawn wrong. */
  unsupported?: string;
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
export function withOpticsBackend(
  definition: MaterialDefinition,
  backend: string,
): MaterialDefinition {
  return {
    ...definition,
    appearance: { ...definition.appearance, assembly: opticsBackends.get(backend).assembly },
  };
}
