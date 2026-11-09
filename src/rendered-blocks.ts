/**
 * The three.js side of every block on screen: a cube built from the block's appearance,
 * in the hand (small, rocking) or on the table (full size, in the board assembly). The hand
 * and field views both build their cubes here, and the selection highlight covers all of
 * them.
 */
import * as THREE from "three";
import type { CardBlock } from "./cards";
import { blockHighlighted } from "./block-trait-behaviours";
import { materialOf } from "./materials";
import { randomRock, type Rock, type RockState } from "./motion";
import type { Selection } from "./traits/selectable";
import type { Cell } from "./traits/attachable";
import { createBlockAppearance } from "./visual/block-appearance";

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
  extras: THREE.Mesh[];
  edgeGeometry: THREE.EdgesGeometry;
  edgeMaterial: THREE.LineBasicMaterial;
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

export function createBlockViews(parents: {
  board: THREE.Object3D;
  hand: THREE.Object3D;
}): BlockViews {
  const all: RenderedBlock[] = [];

  function dispose(rendered: RenderedBlock): void {
    rendered.cube.removeFromParent();
    all.splice(all.indexOf(rendered), 1);
    rendered.geometry.dispose();
    rendered.textures.forEach((texture) => texture.dispose());
    new Set([...rendered.handMaterials, ...rendered.boardMaterials]).forEach((material) =>
      material.dispose(),
    );
    for (const extra of rendered.extras)
      for (const material of ([] as THREE.Material[]).concat(extra.material)) {
        // Extras may own per-face texture copies (the ice's meltwater): free those too.
        (material as THREE.MeshStandardMaterial).map?.dispose();
        material.dispose();
      }
    rendered.edgeGeometry.dispose();
    rendered.edgeMaterial.dispose();
  }

  return {
    all,
    create(block, size, location) {
      const appearance = createBlockAppearance(block.traits.identity, materialOf(block), size);
      const { geometry, textures, edgeColor, edgeOpacity } = appearance;
      const handMaterials = appearance.materials;
      const boardMaterials = appearance.boardMaterials ?? handMaterials;
      const materials = location === "board" ? boardMaterials : handMaterials;
      const cube = new THREE.Mesh(geometry, materials);
      cube.castShadow = cube.receiveShadow = true;
      const edgeGeometry = new THREE.EdgesGeometry(geometry);
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: edgeColor,
        transparent: edgeOpacity < 1,
        opacity: edgeOpacity,
      });
      cube.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
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
        location,
        cell: null,
        baseY: 0,
        rock: location === "hand" ? randomRock() : null,
        handSlot: null,
      } satisfies RenderedBlock;
      all.push(rendered);
      return rendered;
    },
    dispose,
    disposeAll() {
      // dispose removes from `all`, so iterate over a copy.
      for (const rendered of all.slice()) dispose(rendered);
    },
    highlight(selected) {
      all.forEach(({ block, materials }) => {
        const active = blockHighlighted(block, selected);
        new Set(materials).forEach((material) => {
          material.emissive.setHex(0xffffff);
          material.emissiveIntensity = active ? 0.28 : 0;
        });
      });
    },
  };
}
