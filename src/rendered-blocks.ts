import { blockFaceArt } from "./block-presentation";
import { acquiredBonusDescriptor } from "./modifier-registers";
/**
 * The three.js side of every block on screen: a cube built from the block's appearance,
 * in the hand (small, rocking) or on the table (full size, in the board assembly). The hand
 * and field views both build their cubes here, and the selection highlight covers all of
 * them.
 */
import { cardLook } from "./card-look";
import * as THREE from "three";
import type { CardBlock } from "./cards";
import { blockHighlighted } from "./block-trait-behaviours";
import { randomRock, type Rock, type RockState } from "./motion";
import type { Selection } from "./traits/selectable";
import type { Cell } from "./traits/attachable";
import { createBlockAppearance, disposeMaterialTextures } from "./visual/block-appearance";
import type { PrepassRequirements } from "./visual/appearance-prepass";
import { blockOutline } from "./visual/block-outline";

/** The outline colour of a selected block (#305): the game's accent cyan. */
const selectionOutline = 0x65f4dd;

export type RenderedBlock = {
  block: CardBlock;
  cube: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  textures: THREE.CanvasTexture[];
  /** The materials in use now (hand or table). */
  materials: THREE.MeshStandardMaterial[];
  handMaterials: THREE.MeshStandardMaterial[];
  /** Glass and crystal refract on the table, so they change material when they land. */
  boardMaterials: THREE.MeshStandardMaterial[];
  /** Meshes inside the block, such as the crystal's fire. */
  extras: (THREE.Mesh | THREE.Points)[];
  edgeGeometry: THREE.BufferGeometry;
  edgeMaterial: THREE.LineBasicMaterial;
  /** The edge colour and opacity its material gives it, restored when it's deselected. */
  edgeLook: { color: number; opacity: number };
  location: "board" | "hand";
  cell: Cell | null;
  baseY: number;
  rock: Rock | null;
  handSlot: number | null;
  /** A hand block's rock as it runs, so selection can change its speed smoothly. */
  rockState?: RockState;
  /** Where the hand layout wants this cube; it glides there each frame. */
  handX?: number;
};

export type BlockViews = {
  /** Every block on screen, hand and table. */
  readonly all: readonly RenderedBlock[];
  create(block: CardBlock, size: number, location: RenderedBlock["location"]): RenderedBlock;
  dispose(rendered: RenderedBlock): void;
  disposeAll(): void;
  /** Light up the selected blocks that can be selected; dim the rest. */
  highlight(selected: Selection): void;
};

export function createBlockViews(
  parents: {
    board: THREE.Object3D;
    hand: THREE.Object3D;
  },
  /** Where a block's declared prepasses are required while it is shown (#969). */
  prepasses?: PrepassRequirements,
): BlockViews {
  const all: RenderedBlock[] = [];
  /** Each shown block's hold on the prepasses its appearance declared. */
  const held = new Map<RenderedBlock, () => void>();

  function dispose(rendered: RenderedBlock): void {
    held.get(rendered)?.();
    held.delete(rendered);
    rendered.cube.removeFromParent();
    all.splice(all.indexOf(rendered), 1);
    rendered.geometry.dispose();
    rendered.textures.forEach((texture) => texture.dispose());
    new Set([...rendered.handMaterials, ...rendered.boardMaterials]).forEach((material) =>
      material.dispose(),
    );
    // Extras may own per-face texture copies (the ice's meltwater): free those, but not a map
    // shared with every other block (#662).
    disposeMaterialTextures(
      rendered.extras.flatMap((extra) => ([] as THREE.Material[]).concat(extra.material)),
    );
    for (const extra of rendered.extras)
      for (const material of ([] as THREE.Material[]).concat(extra.material)) material.dispose();
    rendered.edgeGeometry.dispose();
    rendered.edgeMaterial.dispose();
  }

  return {
    all,
    create(block, size, location) {
      const look = cardLook(block);
      const appearance = createBlockAppearance(
        blockFaceArt(block, {
          face: look.cardFace,
          bonus: acquiredBonusDescriptor(block),
        }),
        look,
        size,
      );
      const { geometry, textures } = appearance;
      const handMaterials = appearance.materials;
      const boardMaterials = appearance.boardMaterials ?? handMaterials;
      const materials = location === "board" ? boardMaterials : handMaterials;
      const cube = new THREE.Mesh(geometry, materials);
      cube.renderOrder = appearance.faceLayer ?? 0;
      cube.castShadow = cube.receiveShadow = true;
      const outline = blockOutline(appearance);
      const edgeGeometry = outline.geometry;
      const edgeMaterial = outline.material as THREE.LineBasicMaterial;
      cube.add(outline);
      const extras = appearance.extras ?? [];
      for (const extra of extras) cube.add(extra);
      parents[location].add(cube);
      const rendered = {
        block,
        cube,
        geometry,
        textures,
        materials,
        handMaterials,
        boardMaterials,
        extras,
        edgeGeometry,
        edgeMaterial,
        edgeLook: { color: appearance.edgeColor, opacity: appearance.edgeOpacity },
        location,
        cell: null,
        baseY: 0,
        rock: location === "hand" ? randomRock() : null,
        handSlot: null,
      } satisfies RenderedBlock;
      all.push(rendered);
      if (appearance.prepasses?.length && prepasses)
        held.set(rendered, prepasses.require(appearance.prepasses));
      return rendered;
    },
    dispose,
    disposeAll() {
      // dispose removes from `all`, so iterate over a copy.
      for (const rendered of all.slice()) dispose(rendered);
    },
    highlight(selected) {
      all.forEach(({ block, materials, edgeMaterial, edgeLook }) => {
        const active = blockHighlighted(block, selected);
        new Set(materials).forEach((material) => {
          material.emissive.setHex(0xffffff);
          material.emissiveIntensity = active ? 0.28 : 0;
        });
        // A selected block is outlined (#305): its edges turn the selection colour, fully opaque.
        edgeMaterial.color.setHex(active ? selectionOutline : edgeLook.color);
        edgeMaterial.opacity = active ? 1 : edgeLook.opacity;
        edgeMaterial.transparent = edgeMaterial.opacity < 1;
        // A live outline setting (#796) yields to the selection while it is selected.
        edgeMaterial.userData.selected = active;
        edgeMaterial.needsUpdate = true;
      });
    },
  };
}
