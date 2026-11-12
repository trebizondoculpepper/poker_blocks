/**
 * Free a mesh's material whether it has one or an array of them (#768): a layer with a material
 * per face, like ice's, is not a single material, and calling `dispose` on the array throws.
 */
import type * as THREE from "three";

export function disposeMaterials(owner: { material: THREE.Material | THREE.Material[] }): void {
  const { material: held } = owner;
  for (const each of Array.isArray(held) ? held : Array.of(held)) each.dispose();
}
