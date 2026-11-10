import { describe, expect, it } from "vite-plus/test";
import { gridPositions } from "./word-cube-room";

describe("menu block room layout (#303)", () => {
  it("lays cubes in centred rows of four, top row first", () => {
    const positions = gridPositions(7);
    expect(positions).toHaveLength(7);
    // Top row of four, centred on x = 0, above the bottom row of three, also centred.
    const top = positions.slice(0, 4);
    const bottom = positions.slice(4);
    expect(top.reduce((sum, { x }) => sum + x, 0)).toBeCloseTo(0);
    expect(bottom.reduce((sum, { x }) => sum + x, 0)).toBeCloseTo(0);
    expect(top.every(({ y }) => y > 0)).toBe(true);
    expect(bottom.every(({ y }) => y < 0)).toBe(true);
    // No two cubes share a place.
    expect(new Set(positions.map(({ x, y }) => `${x},${y}`)).size).toBe(7);
  });

  it("needs no room for no cubes", () => {
    expect(gridPositions(0)).toEqual([]);
  });
});
