// Hoop/tunnel query probe (#883). Run: node doc/research/hoop-query-probe.mjs
// Writes doc/research/hoop-query-results.json and asserts the fixture verdicts.
//
// Exact method: treat the occupied cells as a cubical complex and compute its first Betti number
// b1 (independent loops/tunnels) from the Euler characteristic: chi = V - E + F - C over the
// complex's distinct vertices, edges, faces and cubes, and b1 = b0 + b2 - chi, where b0 is the
// number of connected pieces and b2 the number of sealed cavities. No external dependency.
//
// Two contact conventions are compared:
//   "closed" – each cell is a closed unit cube, so cells touching only at an edge or a corner
//              are joined (foreground 26-connectivity, background 6-connectivity).
//   "face"   – cells are joined only through shared faces (foreground 6-connectivity). Computed
//              exactly by refining the grid ×3: each cell becomes a 2×2×2 block and each shared
//              face a 1-voxel bridge, so edge/corner-only contact leaves a gap; the closed method
//              then runs on the refined voxels.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

const key = (x, y, z) => `${x},${y},${z}`;
const parse = (k) => k.split(",").map(Number);

/** chi of the union of closed unit cubes at these integer cells: counted on a doubled lattice. */
function euler(cells) {
  // Every cube's 27 closure elements on the doubled lattice: parity of each coordinate gives the
  // element's dimension (odd = extends along that axis). Count distinct elements by dimension.
  const seen = new Set();
  let chi = 0;
  for (const [x, y, z] of cells)
    for (let dx = 0; dx <= 2; dx++)
      for (let dy = 0; dy <= 2; dy++)
        for (let dz = 0; dz <= 2; dz++) {
          const k = key(2 * x + dx, 2 * y + dy, 2 * z + dz);
          if (seen.has(k)) continue;
          seen.add(k);
          const dim = (dx & 1) + (dy & 1) + (dz & 1);
          chi += dim % 2 === 0 ? 1 : -1;
        }
  return { chi, elements: seen.size };
}

const around26 = [];
for (let dx = -1; dx <= 1; dx++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++) if (dx || dy || dz) around26.push([dx, dy, dz]);
const around6 = around26.filter((d) => Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) === 1);

/** Connected pieces of a cell set under the given neighbourhood. */
function components(cells, around) {
  const set = new Set(cells.map((c) => key(...c)));
  const done = new Set();
  const pieces = [];
  for (const start of set) {
    if (done.has(start)) continue;
    const piece = [start];
    done.add(start);
    for (let i = 0; i < piece.length; i++) {
      const [x, y, z] = parse(piece[i]);
      for (const [dx, dy, dz] of around) {
        const k = key(x + dx, y + dy, z + dz);
        if (set.has(k) && !done.has(k)) (done.add(k), piece.push(k));
      }
    }
    pieces.push(piece.map(parse));
  }
  return pieces;
}

/**
 * Sealed cavities of one piece: background cells (6-connected, the dual of closed cubes) inside
 * the piece's bounding box padded by one that cannot reach the padding. Cost is the box volume.
 */
function cavities(piece, budget) {
  const lo = [0, 1, 2].map((a) => Math.min(...piece.map((p) => p[a])) - 1);
  const hi = [0, 1, 2].map((a) => Math.max(...piece.map((p) => p[a])) + 1);
  const volume = hi.reduce((n, v, a) => n * (v - lo[a] + 1), 1);
  if (volume > budget.remaining) return null;
  budget.remaining -= volume;
  const solid = new Set(piece.map((p) => key(...p)));
  const empty = [];
  for (let x = lo[0]; x <= hi[0]; x++)
    for (let y = lo[1]; y <= hi[1]; y++)
      for (let z = lo[2]; z <= hi[2]; z++) if (!solid.has(key(x, y, z))) empty.push([x, y, z]);
  const inside = (p) => p.every((v, a) => v > lo[a] && v < hi[a]);
  return components(empty, around6).filter((region) => region.every(inside)).length;
}

/** b0, b1, b2 of a cell set under the closed-cube convention, within a volume budget. */
function betti(cells, budgetVolume) {
  const pieces = components(cells, around26);
  const budget = { remaining: budgetVolume };
  let b2 = 0;
  for (const piece of pieces) {
    const sealed = cavities(piece, budget);
    if (sealed === null) return { available: false, reason: "volume budget exceeded" };
    b2 += sealed;
  }
  const { chi, elements } = euler(cells);
  return { available: true, b0: pieces.length, b1: pieces.length + b2 - chi, b2, chi, elements };
}

/**
 * The ×3 refinement whose closed-cube topology is the face-contact topology of the cells. Refined
 * voxel (3x+a, 3y+b, 3z+c), a,b,c in {0,1,2}, lies inside cell x (a < 2) or between x and x+1
 * (a = 2) on each axis; it is filled iff every cell it lies within or between is occupied. So a
 * cell fills a 2×2×2 block, a shared face a 1-voxel bridge, four cells round an edge fill that edge
 * line, and eight round a vertex fill the corner voxel. Edge- or corner-only contact leaves a gap.
 */
function refine(cells) {
  const set = new Set(cells.map((c) => key(...c)));
  const out = new Map();
  const spans = (a) => (a === 2 ? [0, 1] : [0]);
  for (const [x, y, z] of cells)
    for (let a = 0; a <= 2; a++)
      for (let b = 0; b <= 2; b++)
        for (let c = 0; c <= 2; c++) {
          const all = spans(a).every((i) =>
            spans(b).every((j) => spans(c).every((k) => set.has(key(x + i, y + j, z + k)))),
          );
          if (all) out.set(key(3 * x + a, 3 * y + b, 3 * z + c), [3 * x + a, 3 * y + b, 3 * z + c]);
        }
  return [...out.values()];
}

const conventions = {
  closed: (cells, budget) => betti(cells, budget),
  face: (cells, budget) => betti(refine(cells), budget * 27),
};

// ---- Fixtures --------------------------------------------------------------------------------
const box = (nx, ny, nz, keep = () => true) => {
  const cells = [];
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) if (keep(x, y, z)) cells.push([x, y, z]);
  return cells;
};
const ring = box(3, 3, 1, (x, y) => x !== 1 || y !== 1);
const rotate = {
  xy: (c) => c,
  xz: (c) => c.map(([x, y, z]) => [x, z, y]),
  yz: (c) => c.map(([x, y, z]) => [z, x, y]),
};
const fixtures = {
  // Positive: owner's flat ring in each principal orientation, and deeper tunnels.
  "ring-xy": ring,
  "ring-xz": rotate.xz(ring),
  "ring-yz": rotate.yz(ring),
  "large-ring-5x5": box(5, 5, 1, (x, y) => x === 0 || y === 0 || x === 4 || y === 4),
  "tunnel-depth-3": box(3, 3, 3, (x, y) => x !== 1 || y !== 1),
  "tunnel-depth-6": box(3, 3, 6, (x, y) => x !== 1 || y !== 1),
  // A tunnel that turns a corner inside a 3×3×3 block: enters on one face, leaves another.
  "bent-tunnel": box(
    3,
    3,
    3,
    (x, y, z) => !((x === 1 && z === 1 && y <= 1) || (y === 1 && z === 1 && x >= 1)),
  ),
  "two-rings-apart": [...ring, ...ring.map(([x, y, z]) => [x + 10, y, z])],
  "two-openings-one-block": box(5, 3, 3, (x, y) => !(y === 1 && (x === 1 || x === 3))),
  // Negative: solids, open shapes, sparse arrangements, a sealed shell.
  "solid-slab-2x2": box(2, 2, 1),
  "solid-cube-3": box(3, 3, 3),
  "u-shape": box(3, 3, 1, (x, y) => !(x === 1 && y >= 1)),
  "long-line": box(12, 1, 1),
  "sparse-distant": [
    [0, 0, 0],
    [40, 0, 0],
    [0, 40, 0],
    [40, 40, 9],
  ],
  "sealed-shell": box(3, 3, 3, (x, y, z) => !(x === 1 && y === 1 && z === 1)),
  // Convention-sensitive: a diamond of cells joined only at edges encloses a gap.
  "edge-contact-diamond": [
    [1, 0, 0],
    [0, 1, 0],
    [2, 1, 0],
    [1, 2, 0],
  ],
  // Corner-only contact: a skew loop of cells that touch at vertices.
  "corner-contact-loop": [
    [0, 0, 0],
    [1, 1, 1],
    [2, 0, 2],
    [1, -1, 1],
  ],
};

const expected = {
  "ring-xy": [1, 1],
  "ring-xz": [1, 1],
  "ring-yz": [1, 1],
  "large-ring-5x5": [1, 1],
  "tunnel-depth-3": [1, 1],
  "tunnel-depth-6": [1, 1],
  "bent-tunnel": [1, 1],
  "two-rings-apart": [2, 2],
  "two-openings-one-block": [2, 2],
  "solid-slab-2x2": [0, 0],
  "solid-cube-3": [0, 0],
  "u-shape": [0, 0],
  "long-line": [0, 0],
  "sparse-distant": [0, 0],
  "sealed-shell": [0, 0],
  "edge-contact-diamond": [1, 0],
  "corner-contact-loop": [1, 0],
};

const budget = 200_000;
const results = {};
for (const [name, cells] of Object.entries(fixtures)) {
  const row = { cells: cells.length };
  for (const [convention, run] of Object.entries(conventions)) row[convention] = run(cells, budget);
  results[name] = row;
  const [closed, face] = expected[name];
  assert.equal(row.closed.b1, closed, `${name} closed b1`);
  assert.equal(row.face.b1, face, `${name} face b1`);
}
assert.equal(results["sealed-shell"].closed.b2, 1, "the shell is a cavity, not a hoop");

// ---- Cost: element counts and timing for growing random connected fields --------------------
// Timings are this machine's, for scale only; rewards must never depend on them.
function randomField(n, seed) {
  let s = seed;
  const next = () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const cells = new Map([[key(0, 0, 0), [0, 0, 0]]]);
  while (cells.size < n) {
    const [x, y, z] = [...cells.values()][Math.floor(next() * cells.size)];
    const [dx, dy, dz] = around6[Math.floor(next() * 6)];
    const c = [x + dx, y + dy, z + dz];
    cells.set(key(...c), c);
  }
  return [...cells.values()];
}
const scaling = [];
for (const n of [27, 64, 125, 250, 500]) {
  const cells = randomField(n, n);
  const row = { cells: n };
  for (const [convention, run] of Object.entries(conventions)) {
    const started = performance.now();
    const r = run(cells, 10_000_000);
    row[convention] = {
      b1: r.b1,
      elements: r.elements,
      ms: Math.round((performance.now() - started) * 100) / 100,
    };
  }
  scaling.push(row);
}
// A sparse field whose padded box exceeds the budget reports unavailable, never a guess.
// One connected staircase of 180 cells along x, then y, then z: a ~62³ padded box.
const staircase = [
  ...box(60, 1, 1),
  ...box(1, 60, 1).map(([x, y, z]) => [x + 59, y, z]),
  ...box(1, 1, 60).map(([x, y, z]) => [x + 59, y + 59, z]),
];
const overBudget = conventions.closed(staircase, 100_000);
assert.equal(overBudget.available, false);

writeFileSync(
  new URL("./hoop-query-results.json", import.meta.url),
  `${JSON.stringify({ fixtures: results, scaling, overBudget }, null, 2)}\n`,
);
console.log(
  "fixtures:",
  Object.fromEntries(Object.entries(results).map(([n, r]) => [n, [r.closed.b1, r.face.b1]])),
);
console.log("scaling:", scaling);
console.log("over budget:", overBudget);
