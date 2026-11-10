import * as THREE from "three";
import { createBlockAppearance } from "./block-appearance";
import type { FaceArt } from "./face-art";
import type { MaterialDefinition } from "../materials";

/** Assemble artwork with registered material appearance. This layer knows no artwork kind. */
export function writtenBlock(
  art: FaceArt,
  definition: MaterialDefinition,
  size: number,
): { object: THREE.Group; dispose(): void } {
  const appearance = createBlockAppearance(art, definition, size);
  const object = new THREE.Group();
  object.add(new THREE.Mesh(appearance.geometry, appearance.materials));
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
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) textures.add(value);
        material.dispose();
      }
      textures.forEach((texture) => texture.dispose());
      geometries.forEach((geometry) => geometry.dispose());
      object.removeFromParent();
      object.clear();
    },
  };
}
