/**
 * Packing density (#815; doc/experiments/spatial-modifiers.md): occupied field cells divided by
 * the capacity of the smallest world-grid-axis-aligned box enclosing them. Side lengths are
 * inclusive (max − min + 1), so a filled line and a filled cube both have density 1. It reads
 * the authoritative occupied cells, never a camera or a mesh. An empty field is unavailable,
 * never zero. Mass is a separate measurement and doesn't affect it. No reward is computed here.
 */
import { contextQueries, type QueryResult } from "./context-queries";
import type { GameState } from "./game-state";

export type PackingDensity = {
  occupied: number;
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  extents: { x: number; y: number; z: number };
  capacity: number;
  density: number;
};

export function packingDensity(state: GameState): QueryResult<PackingDensity> {
  // Unique occupied cells: one per cell, however the field lists them.
  const cells = [
    ...new Map(state.field.map(({ cell }) => [`${cell.x},${cell.y},${cell.z}`, cell])).values(),
  ];
  if (!cells.length) return { available: false, reason: "the field is empty" };
  const axis = (pick: (cell: (typeof cells)[number]) => number) => {
    const values = cells.map(pick);
    return [Math.min(...values), Math.max(...values)] as const;
  };
  const [minX, maxX] = axis(({ x }) => x);
  const [minY, maxY] = axis(({ y }) => y);
  const [minZ, maxZ] = axis(({ z }) => z);
  const extents = { x: maxX - minX + 1, y: maxY - minY + 1, z: maxZ - minZ + 1 };
  const capacity = extents.x * extents.y * extents.z;
  if (!Number.isSafeInteger(capacity))
    return { available: false, reason: "the enclosing box is too large to represent" };
  return {
    available: true,
    value: {
      occupied: cells.length,
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
      extents,
      capacity,
      density: cells.length / capacity,
    },
  };
}

contextQueries.register("packingDensity", {
  cost: "O(n) in occupied cells",
  run: (snapshot) => packingDensity(snapshot),
});
