/**
 * The dev1 materials mode: one block of every material, attached at random to build a
 * small structure on the table, so each substance can be judged next to the others.
 */
import type { CardBlock } from "./cards";
import type { PlacedBlock } from "./game-state";
import { materialOf } from "./materials";
import { cellKey, faceNormal, faces, type Cell } from "./traits/attachable";
import { withoutSelectable } from "./traits/selectable";

/**
 * Take the first card of each material from `deck` and attach each one to a random free
 * face of a block already placed (the first sits at the centre). Returns the structure and
 * the deck without those cards: one block for each material the deck holds.
 */
export function sampleMaterials(
  deck: readonly CardBlock[],
  random: () => number = Math.random,
): { field: PlacedBlock[]; deck: CardBlock[] } {
  const field: PlacedBlock[] = [];
  const occupied = new Set<string>();
  const used = new Set<string>();
  // Every material the deck holds, whichever pool dealt it (dev1 deals experiments too).
  for (const material of new Set(deck.map(materialOf))) {
    const block = deck.find((card) => !used.has(card.id) && materialOf(card) === material);
    if (!block) continue;
    let cell: Cell = { x: 0, y: 0, z: 0 };
    if (field.length) {
      // Any free neighbour of any placed block; a structure this small always has one.
      const free = field.flatMap(({ cell: from }) =>
        faces
          .map((face) => {
            const offset = faceNormal(face);
            return { x: from.x + offset.x, y: from.y + offset.y, z: from.z + offset.z };
          })
          .filter((next) => !occupied.has(cellKey(next))),
      );
      cell = free[Math.floor(random() * free.length)];
    }
    field.push({ block: withoutSelectable(block), cell });
    occupied.add(cellKey(cell));
    used.add(block.id);
  }
  return { field, deck: deck.filter((card) => !used.has(card.id)) };
}
