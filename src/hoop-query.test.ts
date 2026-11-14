import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { query, type QuerySnapshot } from "./context-queries";
import { defaultHoopLimits, hoopTopology, type HoopResult } from "./hoop-query";

type C = [number, number, number];
const box = (
  nx: number,
  ny: number,
  nz: number,
  keep = (_x: number, _y: number, _z: number) => true,
) => {
  const cells: C[] = [];
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) if (keep(x, y, z)) cells.push([x, y, z]);
  return cells;
};
const ring = box(3, 3, 1, (x, y) => x !== 1 || y !== 1);
const asCells = (cells: C[]) => cells.map(([x, y, z]) => ({ x, y, z }));
const topology = (cells: C[]) => {
  const result = hoopTopology(asCells(cells));
  if (!result.available) throw new Error(result.reason);
  return result.value;
};

// The merged research fixtures (doc/research/hoop-query-probe.mjs), face convention b1.
const fixtures: Record<string, [C[], number]> = {
  "ring-xy": [ring, 1],
  "ring-xz": [ring.map(([x, y, z]) => [x, z, y]), 1],
  "ring-yz": [ring.map(([x, y, z]) => [z, x, y]), 1],
  "large-ring-5x5": [box(5, 5, 1, (x, y) => x === 0 || y === 0 || x === 4 || y === 4), 1],
  "tunnel-depth-3": [box(3, 3, 3, (x, y) => x !== 1 || y !== 1), 1],
  "tunnel-depth-6": [box(3, 3, 6, (x, y) => x !== 1 || y !== 1), 1],
  "bent-tunnel": [
    box(3, 3, 3, (x, y, z) => !((x === 1 && z === 1 && y <= 1) || (y === 1 && z === 1 && x >= 1))),
    1,
  ],
  "two-rings-apart": [[...ring, ...ring.map(([x, y, z]): C => [x + 10, y, z])], 2],
  "two-openings-one-block": [box(5, 3, 3, (x, y) => !(y === 1 && (x === 1 || x === 3))), 2],
  "solid-slab-2x2": [box(2, 2, 1), 0],
  "solid-cube-3": [box(3, 3, 3), 0],
  "u-shape": [box(3, 3, 1, (x, y) => !(x === 1 && y >= 1)), 0],
  "long-line": [box(12, 1, 1), 0],
  "sparse-distant": [
    [
      [0, 0, 0],
      [40, 0, 0],
      [0, 40, 0],
      [40, 40, 9],
    ],
    0,
  ],
  "sealed-shell": [box(3, 3, 3, (x, y, z) => !(x === 1 && y === 1 && z === 1)), 0],
  "edge-contact-diamond": [
    [
      [1, 0, 0],
      [0, 1, 0],
      [2, 1, 0],
      [1, 2, 0],
    ],
    0,
  ],
  "corner-contact-loop": [
    [
      [0, 0, 0],
      [1, 1, 1],
      [2, 0, 2],
      [1, -1, 1],
    ],
    0,
  ],
};

describe("face hoop query (#885)", () => {
  it.each(Object.entries(fixtures))("%s", (_, [cells, b1]) => {
    expect(topology(cells).b1).toBe(b1);
    expect(topology(cells).hasLoop).toBe(b1 > 0);
  });

  it("is unchanged by translation, negative coordinates and axis permutation", () => {
    const tunnel = fixtures["bent-tunnel"]![0];
    for (const move of [
      ([x, y, z]: C): C => [x - 7, y + 3, z - 11],
      ([x, y, z]: C): C => [y, z, x],
      ([x, y, z]: C): C => [z - 50, x, y + 2],
    ])
      expect(topology(tunnel.map(move)).b1).toBe(1);
  });

  it("counts a sealed shell as a cavity, not a hoop, beside a separate ring", () => {
    const shell = fixtures["sealed-shell"]![0];
    const both = [...shell, ...ring.map(([x, y, z]): C => [x + 20, y, z])];
    expect(topology(both)).toMatchObject({ b0: 2, b1: 1, b2: 1, hasLoop: true });
  });

  it("answers available false for an empty field and a single cell", () => {
    expect(hoopTopology([])).toEqual({
      available: true,
      value: { hasLoop: false, b0: 0, b1: 0, b2: 0, chi: 0 },
    });
    expect(topology([[0, 0, 0]]).hasLoop).toBe(false);
  });

  it("refuses duplicate or non-integer cells instead of deduplicating", () => {
    const bad = (cells: { x: number; y: number; z: number }[]) =>
      (hoopTopology(cells) as Extract<HoopResult, { available: false }>).reason;
    expect(
      bad([
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ]),
    ).toBe("invalid-occupancy");
    expect(bad([{ x: 0.5, y: 0, z: 0 }])).toBe("invalid-occupancy");
    expect(bad([{ x: 2 ** 53, y: 0, z: 0 }])).toBe("invalid-occupancy");
    expect(bad([{ x: 2 ** 51, y: 0, z: 0 }])).toBe("unsafe-arithmetic");
  });

  it("reports each limit explicitly, with diagnostics, never a stand-in false", () => {
    const over = hoopTopology(asCells(box(257, 1, 1)));
    expect(over).toMatchObject({
      available: false,
      reason: "cell-limit",
      limits: defaultHoopLimits,
      diagnostics: { cells: 257 },
    });
    // A connected staircase whose padded refined box far exceeds the shared visit budget.
    const staircase = [
      ...box(60, 1, 1),
      ...box(1, 59, 1).map(([x, y, z]): C => [x + 59, y + 1, z]),
      ...box(1, 1, 59).map(([x, y, z]): C => [x + 59, y + 59, z + 1]),
    ];
    expect(hoopTopology(asCells(staircase))).toMatchObject({
      available: false,
      reason: "cavity-visit-limit",
    });
    const tight = { ...defaultHoopLimits, refinedVoxels: 10 };
    expect(hoopTopology(asCells(ring), tight)).toMatchObject({ reason: "refined-voxel-limit" });
    const fewElements = { ...defaultHoopLimits, closureElements: 10 };
    expect(hoopTopology(asCells(ring), fewElements)).toMatchObject({
      reason: "closure-element-limit",
    });
  });

  it("charges every component's box to one shared budget", () => {
    const one = box(3, 3, 1, (x, y) => x !== 1 || y !== 1);
    const many = [0, 10, 20, 30].flatMap((dx) => one.map(([x, y, z]): C => [x + dx, y, z]));
    // Each refined ring's padded box is 10×10×4 = 400 visits: three fit, four do not.
    const limits = { ...defaultHoopLimits, cavityVisits: 1_200 };
    expect(hoopTopology(asCells(many.slice(0, 24)), limits).available).toBe(true);
    expect(hoopTopology(asCells(many), limits)).toMatchObject({ reason: "cavity-visit-limit" });
  });
});

describe("the registered faceHoop query (#885)", () => {
  const snapshot = (cells: C[]): QuerySnapshot => ({
    field: cells.map(([x, y, z], i) => ({ block: standardDeck[i % 52]!, cell: { x, y, z } })),
  });

  it("reads the field's cells and shares one result per snapshot and configuration", () => {
    const field = snapshot(ring);
    const first = query("faceHoop", field);
    expect(first).toMatchObject({ available: true, value: { hasLoop: true } });
    expect(query("faceHoop", field)).toBe(first);
    // A new snapshot (any occupancy change) is measured afresh.
    expect(query("faceHoop", snapshot(box(3, 3, 1)))).toMatchObject({ value: { hasLoop: false } });
  });

  it("refuses an invalid limit override rather than clamping it", () => {
    expect(query("faceHoop", snapshot(ring), { limits: { cells: -1 } })).toMatchObject({
      available: false,
      reason: "invalid-limits",
    });
  });
});
