/**
 * Which sound plays when one block attaches to another (#232): the attachment sound of the
 * softer material of the two, read from each material's `acoustics` data. Generic: it never
 * names a material or a pair. Equal hardness is broken by the sound id, so the result does not
 * depend on which block is which.
 */
import type { SoundEffectId } from "./audio/sfx-registry";
import type { CardBlock } from "./cards";
import type { PlacedBlock } from "./game-state";
import type { MaterialDefinition } from "./materials";
import { cellKey, faceNormal, faces } from "./traits/attachable";

type Acoustic = Pick<MaterialDefinition, "acoustics">;

export function attachmentSound(a: Acoustic, b: Acoustic): SoundEffectId {
  return softer(a, b).acoustics.attach;
}

function softer(a: Acoustic, b: Acoustic): Acoustic {
  if (a.acoustics.hardness !== b.acoustics.hardness) {
    return a.acoustics.hardness < b.acoustics.hardness ? a : b;
  }
  return a.acoustics.attach <= b.acoustics.attach ? a : b;
}

/**
 * The sounds for blocks that have just landed on the field: each landed block meets its
 * softest neighbour (or, on an empty table, only itself), and each distinct resolved sound is
 * listed once, so a line of blocks landing together does not stack the same sound.
 */
export function landingSounds(
  landed: readonly PlacedBlock[],
  field: readonly PlacedBlock[],
  acousticsOf: (block: CardBlock) => Acoustic,
): SoundEffectId[] {
  const byCell = new Map(field.map((placed) => [cellKey(placed.cell), placed.block]));
  const sounds = landed.map(({ block, cell }) => {
    const own = acousticsOf(block);
    const neighbours = faces.flatMap((face) => {
      const offset = faceNormal(face);
      const next = byCell.get(
        cellKey({ x: cell.x + offset.x, y: cell.y + offset.y, z: cell.z + offset.z }),
      );
      return next && next.id !== block.id ? [acousticsOf(next)] : [];
    });
    const met = neighbours.reduce((soft, other) => softer(soft, other), neighbours[0] ?? own);
    return attachmentSound(own, met);
  });
  return [...new Set(sounds)];
}
