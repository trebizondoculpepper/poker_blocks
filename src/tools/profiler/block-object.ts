/**
 * A block as the game draws it on the table (#620): the production appearance assembly, its
 * table materials, edges and extras, and the look's ongoing effects (smoke and the like), built
 * from a card and a material definition. Disposal frees what the block made, exactly as the
 * game's own block views do (src/rendered-blocks.ts, src/field-view.ts).
 */
import * as THREE from "three";
import type { CardBlock } from "../../cards";
import type { MaterialDefinition } from "../../materials";
import { createBlockAppearance, disposeMaterialTextures } from "../../visual/block-appearance";
import { cardFaceArt } from "../../visual/face-art";
import { cosmeticRandom, createBlockEffects } from "../../visual/block-effects";
import type { ProfiledObject } from "./cases";

export function tableBlock(card: CardBlock, definition: MaterialDefinition): ProfiledObject {
  const appearance = createBlockAppearance(
    cardFaceArt(card.traits.identity, { face: definition.cardFace }),
    definition,
    1,
  );
  const mesh = new THREE.Mesh(
    appearance.geometry,
    appearance.boardMaterials ?? appearance.materials,
  );
  mesh.renderOrder = appearance.faceLayer ?? 0;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(appearance.geometry),
    new THREE.LineBasicMaterial({
      color: appearance.edgeColor,
      transparent: appearance.edgeOpacity < 1,
      opacity: appearance.edgeOpacity,
    }),
  );
  mesh.add(edges, ...(appearance.extras ?? []));
  // A fixed three-quarter turn, so three faces show, as on the table.
  mesh.rotation.set(0.45, 0.6, 0);
  // Ongoing effects live in world space, as on the table: added beside the block once it is in
  // a scene, advanced every frame from its pose, removed and freed with it (#653 review).
  const effects = createBlockEffects(definition.appearance.effects ?? [], {
    random: cosmeticRandom,
    size: 1,
  });
  return {
    object: mesh,
    update(dt) {
      for (const effect of effects) {
        if (!effect.object.parent && mesh.parent) mesh.parent.add(effect.object);
        effect.update(dt, mesh, false);
      }
    },
    dispose() {
      for (const effect of effects) {
        effect.object.removeFromParent();
        effect.dispose();
      }
      appearance.geometry.dispose();
      // A texture shared with other blocks stays for them (#662).
      appearance.textures.forEach((texture) => {
        if (!texture.userData.shared) texture.dispose();
      });
      new Set([...appearance.materials, ...(appearance.boardMaterials ?? [])]).forEach((material) =>
        material.dispose(),
      );
      // An extra's own texture copy is freed; a shared one stays for its other users (#662).
      disposeMaterialTextures(
        (appearance.extras ?? []).flatMap((extra) =>
          ([] as THREE.Material[]).concat(extra.material),
        ),
      );
      for (const extra of appearance.extras ?? [])
        for (const material of ([] as THREE.Material[]).concat(extra.material)) material.dispose();
      edges.geometry.dispose();
      edges.material.dispose();
    },
  };
}
