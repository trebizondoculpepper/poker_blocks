/**
 * Centre queries (#824; doc/experiments/pivot-comparison.md): pure registered context queries over
 * a snapshot's placed field cells, in grid coordinates (cell centres, never visual deformation).
 *
 * - `fieldCentroid`: sum(p)/n.
 * - `fieldMassCentre`: sum(m × p)/sum(m), with each block's authored mass from its current
 *   material definition (#816). A wrapped Present weighs its wrapper only.
 *
 * Both report the count (and total mass); an empty field is unavailable, never a zero point. A
 * non-positive or non-finite total mass is unavailable too, not a quiet fall back to the centroid.
 * Neither changes the production pivot, which keeps its centroid policy.
 */
import { contextQueries, type QueryResult } from "./context-queries";
import type { GameState } from "./game-state";
import { getMaterialDefinition, materialOf } from "./materials";
import { massKg } from "./physical-mass";

export type Point = { x: number; y: number; z: number };
export type Centroid = { centre: Point; count: number };
export type MassCentre = { centre: Point; count: number; totalKg: number };

export function fieldCentroid(state: GameState): QueryResult<Centroid> {
  const count = state.field.length;
  if (!count) return { available: false, reason: "the field is empty" };
  const sum = { x: 0, y: 0, z: 0 };
  for (const { cell } of state.field) {
    sum.x += cell.x;
    sum.y += cell.y;
    sum.z += cell.z;
  }
  return {
    available: true,
    value: { centre: { x: sum.x / count, y: sum.y / count, z: sum.z / count }, count },
  };
}

export function fieldMassCentre(state: GameState): QueryResult<MassCentre> {
  const count = state.field.length;
  if (!count) return { available: false, reason: "the field is empty" };
  const sum = { x: 0, y: 0, z: 0 };
  let totalKg = 0;
  for (const { block, cell } of state.field) {
    const mass = massKg(getMaterialDefinition(materialOf(block)).mass);
    totalKg += mass;
    sum.x += mass * cell.x;
    sum.y += mass * cell.y;
    sum.z += mass * cell.z;
  }
  if (!(totalKg > 0) || !Number.isFinite(totalKg))
    return { available: false, reason: "the field's total mass is not positive and finite" };
  return {
    available: true,
    value: {
      centre: { x: sum.x / totalKg, y: sum.y / totalKg, z: sum.z / totalKg },
      count,
      totalKg,
    },
  };
}

contextQueries.register("fieldCentroid", {
  cost: "O(n) in placed blocks",
  limit: 1_000_000,
  size: (snapshot) => snapshot.field.length,
  run: (snapshot) => fieldCentroid(snapshot),
});
contextQueries.register("fieldMassCentre", {
  cost: "O(n) in placed blocks",
  limit: 1_000_000,
  size: (snapshot) => snapshot.field.length,
  run: (snapshot) => fieldMassCentre(snapshot),
});
