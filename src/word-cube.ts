import type { SoundEffectId } from "./audio/sfx-registry";
import * as THREE from "three";
import { Block } from "./core/block";
import { writingMaterial, type WritingOptions } from "./letter-block";
import { defaultLettering, loadLettering } from "./visual/lettering";
import { textFaceArt } from "./visual/text-face-art";
import type { FaceArt } from "./visual/face-art";
import type { Lettering } from "./visual/lettering";
import { writtenBlock } from "./visual/written-block";
import { menuAction } from "./traits/menu-action";
import { interactionFeedback, disabledAppearance } from "./traits/interaction-feedback";
import { inspectableTrait } from "./traits/inspectable";
import { ambientPrecession } from "./traits/ambient-precession";
import { longPressInspect } from "./traits/long-press-inspect";

export type WordCubeOptions = WritingOptions & {
  id: string;
  action: string;
  enabled?: boolean;
  /** The sound choosing it plays; omitted, a click. */
  sfx?: SoundEffectId | null;
  description?: string;
  /** Why it is unavailable, when no live reason comes with `input.enabled` (#462). */
  disabledReason?: string;
  feedback?: Partial<typeof interactionFeedback.defaults>;
  /** Compose ambient three-axis precession with these settings (#1075); none when absent. */
  precession?: Partial<typeof ambientPrecession.defaults>;
  /**
   * The face artwork the definition supplies for its label (#1147), such as a label with a
   * registered motif (src/visual/motif-face-art.ts); the plain centred label by default.
   */
  artwork?: (text: string, lettering: Lettering) => FaceArt;
};

/** Create one cube. Scene traits own its outer transform, input hit tests and action routing. */
export async function createWordCube(text: string, options: WordCubeOptions) {
  const material = writingMaterial(options);
  const lettering = material.lettering ?? defaultLettering;
  await loadLettering(lettering, text);
  const visual = writtenBlock(
    (options.artwork ?? textFaceArt)(text, lettering),
    {
      ...material,
      appearance: {
        ...material.appearance,
        geometry: { shape: "box", segments: 0, radius: 0, scale: 1 },
      },
    },
    options.size ?? 1,
  );
  const object = new THREE.Group();
  object.add(visual.object);
  const block = new Block(options.id);
  block.add(menuAction, {
    action: options.action,
    enabled: options.enabled ?? true,
    ...(options.sfx !== undefined ? { sfx: options.sfx } : {}),
  });
  // Precession first: it slots its own node in above the feedback node when the art mounts.
  if (options.precession) block.add(ambientPrecession, options.precession);
  block.add(interactionFeedback, options.feedback);
  block.add(disabledAppearance);
  block.add(inspectableTrait, {
    description: options.description ?? text,
    disabledReason: options.disabledReason ?? "",
  });
  block.add(longPressInspect);
  const materials = new Set<THREE.Material>();
  visual.object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.material)
      for (const entry of ([] as THREE.Material[]).concat(mesh.material)) materials.add(entry);
  });
  block.emit("presentation.mount", { object: visual.object, materials: [...materials] });
  block.emit("input.enabled", options.enabled ?? true);
  return {
    block,
    object,
    material,
    dispose() {
      block.dispose();
      visual.dispose();
      object.removeFromParent();
      object.clear();
    },
  };
}
