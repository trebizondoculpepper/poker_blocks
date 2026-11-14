/**
 * The face-connected hoop query (#885; doc/hoop-query.md). Does the occupied solid of the field
 * have an independent loop or through-tunnel, with blocks joined only through shared faces?
 *
 * A pure registered context query over the committed field's cells: material, rank, camera and
 * renderer play no part. The method is the merged research probe's (doc/research/hoop-query-probe.mjs):
 *
 * 1. Validate the cells (safe integers, no duplicates) and the input limit before allocating.
 * 2. Refine ×3: each cell fills a 2×2×2 block, and a between-cell voxel is filled only when every
 *    cell it spans is occupied, so edge- or corner-only contact leaves a gap.
 * 3. On the refined voxels as closed cubes: chi = V − E + F − C over distinct closure elements,
 *    b0 = 26-connected components, b2 = sealed 6-connected empty regions in each component's own
 *    padded box (only that component solid), all against one shared visit budget.
 * 4. b1 = b0 + b2 − chi; hasLoop is b1 > 0.
 *
 * Any limit exceeded gives an explicit unavailable result with its reason, the limits and the
 * input's size, never a partial count or a stand-in false. Limits are fixed configuration, never
 * a timer or device speed.
 */
import { contextQueries, type QuerySnapshot } from "./context-queries";

type Cell = readonly [number, number, number];

export type HoopLimits = {
  /** Original occupied cells. */
  cells: number;
  /** Refined voxels (27 per cell at most). */
  refinedVoxels: number;
  /** Distinct closure elements (vertices, edges, faces, cubes) counted for chi. */
  closureElements: number;
  /** Padded-box voxel visits for cavity floods, shared by the whole query. */
  cavityVisits: number;
};

/** The initial, reversible experiment limits (doc/hoop-query.md, "Deterministic experimental limits"). */
export const defaultHoopLimits: HoopLimits = {
  cells: 256,
  refinedVoxels: 6_912,
  closureElements: 200_000,
  cavityVisits: 262_144,
};

export type HoopTopology = { hasLoop: boolean; b0: number; b1: number; b2: number; chi: number };

export type HoopUnavailableReason =
  | "invalid-occupancy"
  | "unsafe-arithmetic"
  | "cell-limit"
  | "refined-voxel-limit"
  | "closure-element-limit"
  | "cavity-visit-limit"
  | "invalid-limits";

export type HoopResult =
  | { available: true; value: HoopTopology }
  | {
      available: false;
      reason: HoopUnavailableReason;
      limits: HoopLimits;
      diagnostics: { cells: number; refinedVoxels?: number; closureElements?: number };
    };

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

const around26: Cell[] = [];
for (let dx = -1; dx <= 1; dx++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++) if (dx || dy || dz) around26.push([dx, dy, dz]);
const around6 = around26.filter(([x, y, z]) => Math.abs(x) + Math.abs(y) + Math.abs(z) === 1);

/** Configured limits, each overridable explicitly; a bad override is refused, not clamped. */
function limitsFrom(config: unknown): HoopLimits | null {
  const overrides = ((config ?? {}) as { limits?: Partial<HoopLimits> }).limits ?? {};
  const limits = { ...defaultHoopLimits, ...overrides };
  return Object.values(limits).every((value) => Number.isSafeInteger(value) && value >= 0)
    ? limits
    : null;
}

/** The ×3 refined voxels whose closed-cube topology is the cells' face-contact topology. */
function refine(cells: readonly Cell[], occupied: ReadonlySet<string>): Cell[] {
  const out = new Map<string, Cell>();
  const spans = (a: number) => (a === 2 ? [0, 1] : [0]);
  for (const [x, y, z] of cells)
    for (let a = 0; a <= 2; a++)
      for (let b = 0; b <= 2; b++)
        for (let c = 0; c <= 2; c++) {
          const filled = spans(a).every((i) =>
            spans(b).every((j) => spans(c).every((k) => occupied.has(key(x + i, y + j, z + k)))),
          );
          if (filled) {
            const voxel: Cell = [3 * x + a, 3 * y + b, 3 * z + c];
            out.set(key(...voxel), voxel);
          }
        }
  return [...out.values()];
}

/** Connected pieces of a voxel set under a neighbourhood. */
function components(voxels: readonly Cell[], around: readonly Cell[]): Cell[][] {
  const byKey = new Map(voxels.map((voxel) => [key(...voxel), voxel]));
  const done = new Set<string>();
  const pieces: Cell[][] = [];
  for (const [start, voxel] of byKey) {
    if (done.has(start)) continue;
    done.add(start);
    const piece = [voxel];
    for (let i = 0; i < piece.length; i++) {
      const [x, y, z] = piece[i]!;
      for (const [dx, dy, dz] of around) {
        const next = key(x + dx, y + dy, z + dz);
        const found = byKey.get(next);
        if (found && !done.has(next)) {
          done.add(next);
          piece.push(found);
        }
      }
    }
    pieces.push(piece);
  }
  return pieces;
}

/**
 * Sealed cavities of one component in its own padded box, with only it solid, charging the box's
 * volume to the shared budget first; null when the budget cannot cover it.
 */
function cavities(piece: readonly Cell[], budget: { remaining: number }): number | null {
  const lo = [0, 1, 2].map((a) => Math.min(...piece.map((p) => p[a]!)) - 1);
  const hi = [0, 1, 2].map((a) => Math.max(...piece.map((p) => p[a]!)) + 1);
  const volume = hi.reduce((n, v, a) => n * (v - lo[a]! + 1), 1);
  if (!Number.isSafeInteger(volume) || volume > budget.remaining) return null;
  budget.remaining -= volume;
  const solid = new Set(piece.map((p) => key(...p)));
  const seen = new Set<string>();
  const inBox = (p: Cell) => p.every((v, a) => v >= lo[a]! && v <= hi[a]!);
  const onBorder = (p: Cell) => p.some((v, a) => v === lo[a]! || v === hi[a]!);
  let sealed = 0;
  for (let x = lo[0]!; x <= hi[0]!; x++)
    for (let y = lo[1]!; y <= hi[1]!; y++)
      for (let z = lo[2]!; z <= hi[2]!; z++) {
        const start = key(x, y, z);
        if (solid.has(start) || seen.has(start)) continue;
        seen.add(start);
        const region: Cell[] = [[x, y, z]];
        let open = false;
        for (let i = 0; i < region.length; i++) {
          const p = region[i]!;
          if (onBorder(p)) open = true;
          for (const [dx, dy, dz] of around6) {
            const q: Cell = [p[0] + dx, p[1] + dy, p[2] + dz];
            const k = key(...q);
            if (inBox(q) && !solid.has(k) && !seen.has(k)) {
              seen.add(k);
              region.push(q);
            }
          }
        }
        if (!open) sealed++;
      }
  return sealed;
}

/** chi of the union of closed unit voxels, counted on the doubled lattice; null over the limit. */
function euler(voxels: readonly Cell[], limit: number): { chi: number; elements: number } | null {
  const seen = new Set<string>();
  let chi = 0;
  for (const [x, y, z] of voxels)
    for (let dx = 0; dx <= 2; dx++)
      for (let dy = 0; dy <= 2; dy++)
        for (let dz = 0; dz <= 2; dz++) {
          const k = key(2 * x + dx, 2 * y + dy, 2 * z + dz);
          if (seen.has(k)) continue;
          if (seen.size >= limit) return null;
          seen.add(k);
          chi += ((dx & 1) + (dy & 1) + (dz & 1)) % 2 === 0 ? 1 : -1;
        }
  return { chi, elements: seen.size };
}

/** The hoop topology of these occupied cells, within the configured limits. */
export function hoopTopology(
  cells: readonly { x: number; y: number; z: number }[],
  limits: HoopLimits = defaultHoopLimits,
): HoopResult {
  const unavailable = (
    reason: HoopUnavailableReason,
    more: { refinedVoxels?: number; closureElements?: number } = {},
  ): HoopResult => ({
    available: false,
    reason,
    limits,
    diagnostics: { cells: cells.length, ...more },
  });
  if (cells.length > limits.cells) return unavailable("cell-limit");
  // ×3 and +2 refinement, then ×2 and +2 for closure elements, must stay safe integers.
  const safe = Math.floor((Number.MAX_SAFE_INTEGER - 8) / 6);
  if (cells.some(({ x, y, z }) => ![x, y, z].every(Number.isSafeInteger)))
    return unavailable("invalid-occupancy");
  if (cells.some(({ x, y, z }) => [x, y, z].some((v) => Math.abs(v) > safe)))
    return unavailable("unsafe-arithmetic");
  const occupied = new Set(cells.map(({ x, y, z }) => key(x, y, z)));
  // An invalid authoritative field is refused, never silently deduplicated.
  if (occupied.size !== cells.length) return unavailable("invalid-occupancy");
  const voxels = refine(
    cells.map(({ x, y, z }) => [x, y, z] as const),
    occupied,
  );
  if (voxels.length > limits.refinedVoxels)
    return unavailable("refined-voxel-limit", { refinedVoxels: voxels.length });
  const counted = euler(voxels, limits.closureElements);
  if (!counted)
    return unavailable("closure-element-limit", {
      refinedVoxels: voxels.length,
      closureElements: limits.closureElements,
    });
  const pieces = components(voxels, around26);
  const budget = { remaining: limits.cavityVisits };
  let b2 = 0;
  for (const piece of pieces) {
    const sealed = cavities(piece, budget);
    if (sealed === null)
      return unavailable("cavity-visit-limit", {
        refinedVoxels: voxels.length,
        closureElements: counted.elements,
      });
    b2 += sealed;
  }
  const b0 = pieces.length;
  const b1 = b0 + b2 - counted.chi;
  if (![b0, b1, b2].every((n) => Number.isSafeInteger(n) && n >= 0))
    throw new Error(`hoop query produced invalid Betti numbers ${b0}, ${b1}, ${b2}`);
  return { available: true, value: { hasLoop: b1 > 0, b0, b1, b2, chi: counted.chi } };
}

/** The whole field's occupied cells, as the query reads them. */
const fieldCells = (snapshot: QuerySnapshot) => snapshot.field.map(({ cell }) => cell);

// The registered provider: `{ limits?: Partial<HoopLimits> }` configures it; its limits are its
// own, checked inside with diagnostics, so the registry's generic size gate never cuts it short.
contextQueries.register("faceHoop", {
  cost: "O(n) refined voxels and closure elements; cavity floods bounded by a shared visit budget",
  limit: Number.MAX_SAFE_INTEGER,
  size: (snapshot) => snapshot.field.length,
  run: (snapshot, config) => {
    const limits = limitsFrom(config);
    if (!limits)
      return {
        available: false,
        reason: "invalid-limits",
        limits: defaultHoopLimits,
        diagnostics: { cells: snapshot.field.length },
      };
    return hoopTopology(fieldCells(snapshot), limits);
  },
});
