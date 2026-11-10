/**
 * Field service: the blocks placed on the table and what is drawn around them. It keeps
 * each placed cube in its cell and the structure's centre of mass (the board rotates about
 * it), previews a drop (a ghost outline per cell and the face it would attach to), pulses
 * the outline that invites the first play of a stage, and tints a scoring row gold.
 *
 * The rules decide where a block may go; this service shows it and finds which face of a
 * placed block is under a ray.
 */
import * as THREE from "three";
import type { CardBlock } from "./cards";
import { addCell, centerOfGravity, removeCell, type MassCenter } from "./center-of-gravity";
import type { BlockViews, RenderedBlock } from "./rendered-blocks";
import { cellKey, faceFromDirection, faceNormal, type Cell, type Face } from "./traits/attachable";

/** A block a drop can attach to: one on the table, or one played and still flying in. */
export type DropTarget = { block: CardBlock; cell?: Cell | null };

/** Where a drop would play: a face (or the empty centre), and the cells it would fill. */
export type Candidate = {
  target: DropTarget | null;
  face: Face | null;
  cell: Cell;
  cells: Cell[];
};

export type FieldView = {
  /** The placed cubes. */
  blocks(): RenderedBlock[];
  /** The placed cells: blocks that have landed. */
  cells(): Cell[];
  /**
   * The cells a drop is tested against: placed blocks and blocks played but still flying in
   * (#167), so input follows the game state, not the animation.
   */
  occupiedCells(): Cell[];
  readonly massCenter: MassCenter;
  /** Put a block straight into its cell (a run being rebuilt). */
  add(block: CardBlock, cell: Cell): RenderedBlock;
  /** The table's version of a block, in its cell but hidden (it dissolves in on landing). */
  landing(block: CardBlock, cell: Cell): RenderedBlock;
  /**
   * A block has been played into this cell and is about to fly there (#167). Until it lands it
   * is an invisible, hit-testable stand-in, so a drop straight after a play can attach to it
   * or find the face it now covers taken.
   */
  expect(block: CardBlock, cell: Cell): void;
  /** A cube that has arrived in its cell becomes part of the structure. */
  adopt(rendered: RenderedBlock, cell: Cell): void;
  /** A cell's centre in the board assembly. */
  cellPosition(cell: Cell, target: THREE.Vector3): THREE.Vector3;
  /** The placed block and face under a ray, if any. */
  faceAt(raycaster: THREE.Raycaster): { target: DropTarget; face: Face } | null;
  /** Preview a drop, or clear the preview with null. */
  showCandidate(candidate: Candidate | null): void;
  /** Pulse the outline of the first play's cell, or hide it with null. */
  showPrompt(cell: Cell | null, time: number, reducedMotion: boolean): void;
  /**
   * A scene composing `firstPlayPrompt` came to the front, or left (#203). The prompt is drawn
   * only while such a scene is on the stack, so the title never shows it.
   */
  promptEntered(entered: boolean): void;
  /** Briefly tint these blocks toward gold. */
  tint(blocks: readonly CardBlock[], now: number): void;
  /** Advance the tints by one frame. */
  update(now: number): void;
  /**
   * Take a destroyed block off the table: dispose its cube and move the centre of mass.
   * The gap stays; nothing settles into it.
   */
  remove(blockId: string): void;
  /** Forget every placed block (the cubes themselves are disposed elsewhere). */
  clear(): void;
  dispose(): void;
};

/** Seconds a scoring tint takes to rise and fall. */
export const tintSeconds = 0.6;
const tintColor = new THREE.Color(0xffd36b);
/** Cubes sit a little into the felt. */
const sink = 0.45;

export function createFieldView(options: {
  views: BlockViews;
  /** The board assembly the field's cubes and previews live in. */
  assembly: THREE.Object3D;
  cubeSize: number;
  /** The structure's centre of mass moved: the board's rotation centre follows it. */
  onCenter(center: { x: number; y: number; z: number }): void;
}): FieldView {
  const { views, assembly, cubeSize } = options;
  const placed = new Map<string, RenderedBlock>();
  /** How many scenes in front compose `firstPlayPrompt`; the prompt shows while any does. */
  let promptScenes = 0;
  /** Blocks played and still flying in, by cell: invisible stand-ins for hit-testing (#167). */
  const expected = new Map<string, { block: CardBlock; cell: Cell; cube: THREE.Mesh }>();
  const forget = (key: string, standIn: { cube: THREE.Mesh }) => {
    assembly.remove(standIn.cube);
    expected.delete(key);
  };
  let massCenter: MassCenter = { count: 0, sum: { x: 0, y: 0, z: 0 } };
  const tints: { blocks: RenderedBlock[]; startedAt: number }[] = [];

  const ghostGeometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
  const ghostMaterial = new THREE.MeshBasicMaterial({
    color: 0x65f4dd,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const ghost = new THREE.Mesh(ghostGeometry, ghostMaterial);
  ghost.visible = false;
  assembly.add(ghost);
  const ghostEdgeGeometry = new THREE.EdgesGeometry(ghostGeometry);
  const ghostEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x65f4dd, transparent: true });
  ghost.add(new THREE.LineSegments(ghostEdgeGeometry, ghostEdgeMaterial));
  /** Extra outlines for the rest of a line being placed (the first cell uses `ghost`). */
  const lineGhosts: THREE.Mesh[] = [];
  let ghostIsDropPreview = false;

  const faceGeometry = new THREE.PlaneGeometry(cubeSize * 0.94, cubeSize * 0.94);
  const faceMaterial = new THREE.MeshBasicMaterial({
    color: 0x65f4dd,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const faceHighlight = new THREE.Mesh(faceGeometry, faceMaterial);
  faceHighlight.visible = false;
  faceHighlight.renderOrder = 10;
  assembly.add(faceHighlight);

  const placeAt = (object: THREE.Object3D, cell: Cell) =>
    object.position.set(cell.x * cubeSize, cell.y * cubeSize - sink, cell.z * cubeSize);

  function inCell(rendered: RenderedBlock, cell: Cell): RenderedBlock {
    rendered.cell = cell;
    rendered.baseY = cell.y * cubeSize - sink;
    rendered.cube.position.set(cell.x * cubeSize, rendered.baseY, cell.z * cubeSize);
    return rendered;
  }

  function join(rendered: RenderedBlock, cell: Cell): void {
    placed.set(cellKey(cell), rendered);
    massCenter = addCell(massCenter, cell);
    options.onCenter(centerOfGravity(massCenter));
  }

  function showLineGhosts(cells: readonly Cell[]): void {
    while (lineGhosts.length < cells.length) {
      const extra = ghost.clone();
      assembly.add(extra);
      lineGhosts.push(extra);
    }
    lineGhosts.forEach((extra, index) => {
      const cell = cells[index];
      extra.visible = Boolean(cell);
      if (cell) placeAt(extra, cell);
    });
  }

  return {
    blocks: () => [...placed.values()],
    cells: () => [...placed.values()].map(({ cell }) => cell!),
    occupiedCells: () => [...placed.values(), ...expected.values()].map(({ cell }) => cell!),
    expect(block, cell) {
      // Invisible meshes are still hit by a raycaster; they are never drawn.
      const cube = new THREE.Mesh(ghostGeometry, ghostMaterial);
      cube.visible = false;
      placeAt(cube, cell);
      assembly.add(cube);
      expected.set(cellKey(cell), { block, cell, cube });
    },
    get massCenter() {
      return massCenter;
    },
    remove(blockId) {
      for (const [key, standIn] of [...expected].filter(([, { block }]) => block.id === blockId))
        forget(key, standIn);
      for (const [key, rendered] of [...placed].filter(([, { block }]) => block.id === blockId)) {
        placed.delete(key);
        massCenter = removeCell(massCenter, rendered.cell!);
        views.dispose(rendered);
      }
      if (massCenter.count > 0) options.onCenter(centerOfGravity(massCenter));
    },
    add(block, cell) {
      const rendered = inCell(views.create(block, cubeSize, "board"), cell);
      join(rendered, cell);
      return rendered;
    },
    landing(block, cell) {
      const target = inCell(views.create(block, cubeSize, "board"), cell);
      target.cube.visible = false;
      return target;
    },
    adopt(rendered, cell) {
      // Same look in hand and on the table: a flown block simply stays where it landed.
      rendered.location = "board";
      rendered.cell = cell;
      rendered.baseY = cell.y * cubeSize - sink;
      rendered.rock = null;
      rendered.handSlot = null;
      join(rendered, cell);
      const standIn = expected.get(cellKey(cell));
      if (standIn) forget(cellKey(cell), standIn);
    },
    cellPosition(cell, target) {
      return target.set(cell.x * cubeSize, cell.y * cubeSize - sink, cell.z * cubeSize);
    },
    faceAt(raycaster) {
      const blocks = [...placed.values(), ...expected.values()];
      const hit = raycaster.intersectObjects(
        blocks.map(({ cube }) => cube),
        false,
      )[0];
      if (!hit?.face) return null;
      const target = blocks.find(({ cube }) => cube === hit.object);
      if (!target?.cell) return null;
      // The strongest axis, so a hit on a bevel or rounded edge still picks a face.
      return { target, face: faceFromDirection(hit.face.normal) };
    },
    showCandidate(candidate) {
      ghostIsDropPreview = Boolean(candidate);
      ghost.visible = Boolean(candidate);
      faceHighlight.visible = Boolean(candidate?.target);
      showLineGhosts(candidate?.cells.slice(1) ?? []);
      if (!candidate) return;
      placeAt(ghost, candidate.cell);
      if (!candidate.target?.cell || !candidate.face) return;
      const normal = faceNormal(candidate.face);
      faceHighlight.position.set(
        (candidate.target.cell.x + normal.x * 0.505) * cubeSize,
        (candidate.target.cell.y + normal.y * 0.505) * cubeSize - sink,
        (candidate.target.cell.z + normal.z * 0.505) * cubeSize,
      );
      faceHighlight.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(normal.x, normal.y, normal.z),
      );
    },
    promptEntered(entered) {
      promptScenes = Math.max(0, promptScenes + (entered ? 1 : -1));
    },
    showPrompt(requested, time, reducedMotion) {
      // Only a scene that composes the prompt shows it.
      const cell = promptScenes > 0 ? requested : null;
      ghost.visible = ghostIsDropPreview || Boolean(cell);
      if (!ghost.visible) return;
      if (ghostIsDropPreview) {
        ghostMaterial.opacity = 0.18;
        ghostEdgeMaterial.opacity = 1;
        return;
      }
      placeAt(ghost, cell!);
      const pulse = reducedMotion ? 0.8 : (1 + Math.cos((time * Math.PI * 2) / 1800)) / 2;
      ghostMaterial.opacity = 0.18 * pulse;
      ghostEdgeMaterial.opacity = pulse;
    },
    tint(blocks, now) {
      const ids = new Set(blocks.map(({ id }) => id));
      tints.push({ blocks: views.all.filter(({ block }) => ids.has(block.id)), startedAt: now });
    },
    update(now) {
      for (let index = tints.length - 1; index >= 0; index--) {
        const tint = tints[index];
        const progress = Math.min(1, (now - tint.startedAt) / 1000 / tintSeconds);
        const strength = Math.sin(progress * Math.PI) * 0.7;
        tint.blocks.forEach(({ materials }) => {
          new Set(materials).forEach((material) =>
            material.color.setRGB(1, 1, 1).lerp(tintColor, strength),
          );
        });
        if (progress === 1) tints.splice(index, 1);
      }
    },
    clear() {
      placed.clear();
      for (const { cube } of expected.values()) assembly.remove(cube);
      expected.clear();
      tints.length = 0;
      massCenter = { count: 0, sum: { x: 0, y: 0, z: 0 } };
    },
    dispose() {
      ghostGeometry.dispose();
      ghostMaterial.dispose();
      ghostEdgeGeometry.dispose();
      ghostEdgeMaterial.dispose();
      faceGeometry.dispose();
      faceMaterial.dispose();
    },
  };
}
