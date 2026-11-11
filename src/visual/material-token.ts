/**
 * A token drawn as a plain block of a material (#391): the material's own block appearance with
 * blank face art, so it shows the material and no rank or suit. A transmogrifier is drawn this
 * way, in the rack, the shop and the object browser alike.
 */
import * as THREE from "three";
import { getMaterialDefinition, type BlockMaterial } from "../materials";
import { passiveVisualBuilders } from "../passive-visual";
import { createBlockAppearance } from "./block-appearance";

passiveVisualBuilders.register("materialBlock", (_appearance, size, raw) => {
  const { material } = raw as { material: BlockMaterial };
  const block = createBlockAppearance(
    { seed: `token-${material}`, paint: () => {} },
    getMaterialDefinition(material),
    size,
  );
  const edges = new THREE.EdgesGeometry(block.geometry);
  const materials = block.materials;
  return {
    geometry: block.geometry,
    materials,
    textures: block.textures,
    edges,
    faces: [],
    // The material's own inside (the fire's flame, custard's fluid), drawn within the token.
    extras: block.extras ?? [],
    dispose() {
      block.geometry.dispose();
      edges.dispose();
      new Set([...materials, ...(block.boardMaterials ?? [])]).forEach((each) => each.dispose());
      (block.extras ?? []).forEach((mesh) => (mesh.material as THREE.Material).dispose());
      block.textures.forEach((texture) => texture.dispose());
    },
  };
});
