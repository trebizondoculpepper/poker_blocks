import * as THREE from "three";
import { Block } from "./core/block";
import { writingMaterial, type WritingOptions } from "./letter-block";
import { defaultLettering, loadLettering } from "./visual/lettering";
import { textFaceArt } from "./visual/text-face-art";
import { writtenBlock } from "./visual/written-block";
import { menuAction } from "./traits/menu-action";
import { interactionFeedback, disabledAppearance } from "./traits/interaction-feedback";
import { inspectableTrait } from "./traits/inspectable";

export type WordCubeOptions = WritingOptions & {
  id: string;
  action: string;
  enabled?: boolean;
  description?: string;
  feedback?: Partial<typeof interactionFeedback.defaults>;
};

/** Create one cube. Scene traits own its outer transform, input hit tests and action routing. */
export async function createWordCube(text: string, options: WordCubeOptions) {
  const material = writingMaterial(options);
  const lettering = material.lettering ?? defaultLettering;
  await loadLettering(lettering, text);
  const visual = writtenBlock(
    textFaceArt(text, lettering),
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
  block.add(menuAction, { action: options.action, enabled: options.enabled ?? true });
  block.add(interactionFeedback, options.feedback);
  block.add(disabledAppearance);
  block.add(inspectableTrait, { description: options.description ?? text });
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
