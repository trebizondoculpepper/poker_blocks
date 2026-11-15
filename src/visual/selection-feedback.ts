/**
 * Appearance-owned selection feedback (#1153, #1314; doc/game-architecture.md, "Appearance-owned
 * selection feedback"). A look's assembly declares which registered provider shows it selected;
 * whoever mounts the look binds that provider to the resources the look itself created, and the
 * generic view only ever calls `setSelected`. No view code assumes a material class or checks for
 * an `emissive` property.
 *
 * - **emissive**: for looks built from standard materials. Selected adds the configured white face
 *   contribution (0.28, the retained tuning) on top of each material's captured baseline;
 *   deselected restores exactly that baseline. Repeated calls are idempotent.
 * - **overlay**: for any look, whatever its materials (a shader front): an additive copy of the
 *   mount's own geometry at the configured opacity, attached while selected. No material changes.
 *
 * A binding is released with its look (`dispose`): it restores what it changed and frees only what
 * it created, never a shared texture or another block's material.
 */
import * as THREE from "three";
import { Registry } from "../core/registry";
import type { BlockAppearance } from "./block-appearance";

export type SelectionBinding = {
  setSelected(selected: boolean): void;
  dispose(): void;
};

export type SelectionFeedbackProvider = (
  appearance: BlockAppearance,
  mount: THREE.Mesh,
  config: unknown,
) => SelectionBinding;

export const selectionFeedbackProviders = new Registry<SelectionFeedbackProvider>(
  "selection feedback provider",
);

/** The retained face contribution of a selected block (#305). */
export const selectedFaceContribution = 0.28;

type EmissiveConfig = { colour?: number; intensity?: number };

selectionFeedbackProviders.register("emissive", (appearance, _mount, raw) => {
  const config = (raw ?? {}) as EmissiveConfig;
  const contribution = config.intensity ?? selectedFaceContribution;
  const colour = new THREE.Color(config.colour ?? 0xffffff);
  // The look's own standard materials, each once, with the baseline it was authored with.
  const materials = [...new Set([...appearance.materials, ...(appearance.boardMaterials ?? [])])];
  const baselines = materials.map((material) => ({
    material,
    colour: material.emissive.clone(),
    intensity: material.emissiveIntensity,
  }));
  let selected = false;
  const apply = (on: boolean) => {
    for (const { material, colour: base, intensity } of baselines) {
      material.emissive.copy(on ? colour : base);
      material.emissiveIntensity = on ? intensity + contribution : intensity;
    }
  };
  return {
    setSelected(next) {
      if (next === selected) return;
      selected = next;
      apply(next);
    },
    dispose() {
      if (selected) apply(false);
      selected = false;
    },
  };
});

type OverlayConfig = { colour?: number; opacity?: number };

selectionFeedbackProviders.register("overlay", (_appearance, mount, raw) => {
  const config = (raw ?? {}) as OverlayConfig;
  const material = new THREE.MeshBasicMaterial({
    color: config.colour ?? 0xffffff,
    transparent: true,
    opacity: config.opacity ?? selectedFaceContribution,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const overlay = new THREE.Mesh(mount.geometry, material);
  overlay.renderOrder = mount.renderOrder + 1;
  let disposed = false;
  return {
    setSelected(next) {
      if (disposed) return;
      // Follow the mount's own layers, so it draws wherever the block does.
      overlay.layers.mask = mount.layers.mask;
      if (next) mount.add(overlay);
      else overlay.removeFromParent();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      overlay.removeFromParent();
      material.dispose();
    },
  };
});

/** Bind a look's declared provider to its mount; an undeclared or unknown one is an error. */
export function bindSelectionFeedback(
  appearance: BlockAppearance,
  mount: THREE.Mesh,
): SelectionBinding {
  const declared = appearance.selectionFeedback;
  if (!declared) throw new Error("This appearance declares no selection feedback provider");
  return selectionFeedbackProviders.get(declared.provider)(appearance, mount, declared.config);
}
