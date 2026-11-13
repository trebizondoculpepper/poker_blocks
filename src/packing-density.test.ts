import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { contextQueries, query } from "./context-queries";
import type { GameState } from "./game-state";
import "./packing-density";

const field = (...cells: [number, number, number][]): GameState =>
  ({
    field: cells.map(([x, y, z], index) => ({ block: standardDeck[index]!, cell: { x, y, z } })),
    hand: [],
    deck: [],
    discardPile: [],
    passiveRack: [],
    coins: 0,
    round: { score: 0, targetScore: 0, movesLeft: 0, discardsLeft: 0 },
  }) as GameState;

const density = (state: GameState) => {
  const result = query<{ density: number; capacity: number; occupied: number }>(
    "packingDensity",
    state,
  );
  if (!result.available) throw new Error(result.reason);
  return result.value;
};

describe("packing density query (#815)", () => {
  it("is 1 for a single block, a filled line and a filled cube", () => {
    expect(density(field([0, 0, 0])).density).toBe(1);
    expect(density(field([0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0])).density).toBe(1);
    const cube: [number, number, number][] = [];
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) cube.push([x, y, z]);
    expect(density(field(...cube)).density).toBe(1);
  });

  it("drops sharply for a distant outlier, using inclusive extents", () => {
    const result = density(field([0, 0, 0], [1, 0, 0], [5, 2, 0]));
    expect(result.occupied).toBe(3);
    expect(result.capacity).toBe(6 * 3 * 1);
    expect(result.density).toBeCloseTo(3 / 18);
  });

  it("counts a cell once, and an empty field is unavailable, not zero", () => {
    expect(density(field([0, 0, 0], [0, 0, 0])).occupied).toBe(1);
    expect(query("packingDensity", field())).toEqual({
      available: false,
      reason: "the field is empty",
    });
  });

  it("handles a very large field without an engine argument limit (#846 review)", () => {
    const line: [number, number, number][] = Array.from({ length: 150_000 }, (_, x) => [x, 0, 0]);
    const state = {
      ...field(),
      field: line.map(([x, y, z]) => ({ block: standardDeck[0]!, cell: { x, y, z } })),
    } as GameState;
    expect(density(state)).toMatchObject({ occupied: 150_000, capacity: 150_000, density: 1 });
  });

  it("rejects non-grid coordinates and inputs past the declared limit (#846 review)", () => {
    expect(query("packingDensity", field([0.5, 0, 0])).available).toBe(false);
    expect(query("packingDensity", field([2 ** 60, 0, 0])).available).toBe(false);
    contextQueries.register("test.tiny", {
      cost: "O(1)",
      limit: 1,
      size: (snapshot) => snapshot.field.length,
      run: () => ({ available: true, value: "ran" }),
    });
    expect(query("test.tiny", field([0, 0, 0], [1, 0, 0]))).toMatchObject({ available: false });
    expect(query("test.tiny", field([0, 0, 0]))).toEqual({ available: true, value: "ran" });
  });

  it("keeps omitted and null configuration apart in its cache (#846 review)", () => {
    contextQueries.register("test.config", {
      cost: "O(1)",
      limit: Infinity,
      size: () => 0,
      run: (_snapshot, config) => ({
        available: true,
        value: config === null ? "null" : "default",
      }),
    });
    const state = field([0, 0, 0]);
    expect(query("test.config", state)).toEqual({ available: true, value: "default" });
    expect(query("test.config", state, null)).toEqual({ available: true, value: "null" });
  });

  it("is cached per snapshot, and a new snapshot is computed afresh", () => {
    const state = field([0, 0, 0], [1, 0, 0]);
    expect(query("packingDensity", state)).toBe(query("packingDensity", state));
    const moved = {
      ...state,
      field: [...state.field, { block: standardDeck[9]!, cell: { x: 3, y: 0, z: 0 } }],
    };
    expect(density(moved).density).toBe(3 / 4);
    expect(contextQueries.get("packingDensity").cost).toMatch(/O\(n\)/);
  });
});
