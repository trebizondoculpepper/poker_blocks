import * as THREE from "three";
import { createBlockAppearance, type BlockAppearance } from "./block-appearance";
import type { FaceArt } from "./face-art";
import type { MaterialDefinition } from "../materials";

/**
 * Which of an appearance's materials a written block wears: the hand's (the default), or, for
 * a block shown as if on the table, its board materials (where glass and crystal refract).
 */
export type Finish = (appearance: BlockAppearance) => THREE.Material[];
export const handFinish: Finish = (appearance) => appearance.materials;
export const boardFinish: Finish = (appearance) =>
  appearance.boardMaterials ?? appearance.materials;

/** Assemble artwork with registered material appearance. This layer knows no artwork kind. */
export function writtenBlock(
  art: FaceArt,
  definition: MaterialDefinition,
  size: number,
  finish: Finish = handFinish,
): {
  object: THREE.Group;
  /**
   * What reflects a renderer's own environment: the block's face materials, and any extra
   * material marked `userData.reflective` (a vessel's gloss); not other extras (a fire's
   * glass, crystal fire), which keep their own look.
   */
  surfaces: readonly THREE.Material[];
  dispose(): void;
} {
  const appearance = createBlockAppearance(art, definition, size);
  const object = new THREE.Group();
  const faces = finish(appearance);
  const body = new THREE.Mesh(appearance.geometry, faces);
  body.renderOrder = appearance.faceLayer ?? 0;
  object.add(body);
  const surfaces = [
    ...faces,
    ...(appearance.extras ?? [])
      .flatMap(({ material }) => [material].flat())
      .filter((material) => material.userData.reflective === true),
  ];
  for (const extra of appearance.extras ?? []) object.add(extra);
  const edges = new THREE.EdgesGeometry(appearance.geometry);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: appearance.edgeColor,
    transparent: true,
    opacity: appearance.edgeOpacity,
  });
  object.add(new THREE.LineSegments(edges, edgeMaterial));
  let disposed = false;
  return {
    object,
    surfaces,
    dispose() {
      if (disposed) return;
      disposed = true;
      const textures = new Set<THREE.Texture>(appearance.textures);
      const materials = new Set<THREE.Material>([
        ...appearance.materials,
        ...(appearance.boardMaterials ?? []),
        edgeMaterial,
      ]);
      const geometries = new Set<THREE.BufferGeometry>([appearance.geometry, edges]);
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.geometry) return;
        geometries.add(mesh.geometry);
        for (const material of ([] as THREE.Material[]).concat(mesh.material))
          materials.add(material);
      });
      for (const material of materials) {
        // Face maps (including per-face extra clones) belong to this visual.
        // Environment maps are borrowed from the scene and must survive its disposal.
        const faceMap = (material as THREE.MeshStandardMaterial).map;
        if (faceMap) textures.add(faceMap);
        material.dispose();
      }
      textures.forEach((texture) => texture.dispose());
      geometries.forEach((geometry) => geometry.dispose());
      object.removeFromParent();
      object.clear();
    },
  };
}
