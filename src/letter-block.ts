import * as THREE from "three";
import {
  materialPools,
  getMaterialDefinition,
  type BlockMaterial,
  type MaterialDefinition,
} from "./materials";
import { defaultLettering, graphemes, loadLettering } from "./visual/lettering";
import { textFaceArt } from "./visual/text-face-art";
import { writtenBlock } from "./visual/written-block";

export type WritingOptions = { material?: BlockMaterial; random?: () => number; size?: number };
/** All registered materials are eligible; choose once and retain the actual definition. */
export function writingMaterial(options: WritingOptions): MaterialDefinition {
  if (options.material !== undefined) return getMaterialDefinition(options.material);
  const materials = materialPools.get("registered")();
  const roll = (options.random ?? Math.random)();
  if (!(roll >= 0 && roll < 1))
    throw new Error("Material random source must return a value in [0, 1)");
  return materials[Math.floor(roll * materials.length)]!;
}

export async function createLetterBlock(character: string, options: WritingOptions = {}) {
  if (graphemes(character).length !== 1)
    throw new Error("A letter block needs exactly one character");
  const material = writingMaterial(options);
  const lettering = material.lettering ?? defaultLettering;
  await loadLettering(lettering, character);
  const visual = writtenBlock(textFaceArt(character, lettering), material, options.size ?? 1);
  return { ...visual, material, character };
}

/** A word is a rigid group; spaces reserve a full block-width gap. */
export async function createWord(text: string, options: WritingOptions = {}) {
  const object = new THREE.Group();
  const letters: Awaited<ReturnType<typeof createLetterBlock>>[] = [];
  const characters = graphemes(text);
  const spacing = (options.size ?? 1) * 1.1;
  try {
    for (const [index, character] of characters.entries()) {
      if (/\s/u.test(character)) continue;
      const letter = await createLetterBlock(character, options);
      letter.object.position.x = (index - (characters.length - 1) / 2) * spacing;
      object.add(letter.object);
      letters.push(letter);
    }
  } catch (error) {
    letters.forEach((letter) => letter.dispose());
    throw error;
  }
  return {
    object,
    letters,
    dispose() {
      letters.forEach((letter) => letter.dispose());
      object.removeFromParent();
      object.clear();
    },
  };
}
