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
  // World-grid cells only: a fractional or unsafe coordinate is not a cell to measure.
  if (cells.some(({ x, y, z }) => ![x, y, z].every(Number.isSafeInteger)))
    return { available: false, reason: "a field cell has a non-integer coordinate" };
  // One pass, no spread: bounds over any number of cells, with no engine argument limit.
  let [minX, minY, minZ] = [Infinity, Infinity, Infinity];
  let [maxX, maxY, maxZ] = [-Infinity, -Infinity, -Infinity];
  for (const { x, y, z } of cells) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
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

/** The most field entries the packing query scans. */
export const packingQueryLimit = 1_000_000;

contextQueries.register("packingDensity", {
  cost: "O(n) in occupied cells",
  limit: packingQueryLimit,
  size: (snapshot) => snapshot.field.length,
  run: (snapshot) => packingDensity(snapshot),
});
