import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { query } from "./context-queries";
import type { GameState } from "./game-state";
import { getMaterialDefinition, withMaterial } from "./materials";
import "./center-queries";

const block = (material: string, index: number): CardBlock =>
  withMaterial(standardDeck[index]!, getMaterialDefinition(material as never));

const field = (...placed: [string, number, number, number][]): GameState =>
  ({
    field: placed.map(([material, x, y, z], index) => ({
      block: block(material, index),
      cell: { x, y, z },
    })),
    hand: [],
    deck: [],
    discardPile: [],
    passiveRack: [],
    coins: 0,
    round: { score: 0, targetScore: 0, movesLeft: 0, discardsLeft: 0 },
  }) as GameState;

const value = <T>(result: { available: boolean; value?: T }) => {
  expect(result.available).toBe(true);
  return result.value as T;
};

describe("centre queries (#824)", () => {
  it("agree when every block has the same mass", () => {
    const state = field(["wood", 0, 0, 0], ["wood", 2, 0, 0], ["wood", 1, 3, 0]);
    const centroid = value<{ centre: object }>(query("fieldCentroid", state));
    const massCentre = value<{ centre: { x: number; y: number }; totalKg: number }>(
      query("fieldMassCentre", state),
    );
    expect(centroid.centre).toEqual({ x: 1, y: 1, z: 0 });
    expect(massCentre.centre.x).toBeCloseTo(1, 12);
    expect(massCentre.centre.y).toBeCloseTo(1, 12);
    expect(massCentre.totalKg).toBeCloseTo(1.95, 12);
  });

  it("a heavy block pulls the mass centre toward itself, not onto itself", () => {
    const state = field(["wood", 0, 0, 0], ["gold", 4, 0, 0]);
    const { centre } = value<{ centre: { x: number } }>(query("fieldMassCentre", state));
    expect(value<{ centre: { x: number } }>(query("fieldCentroid", state)).centre.x).toBe(2);
    expect(centre.x).toBeCloseTo((19.32 * 4) / (19.32 + 0.65), 9);
    expect(centre.x).toBeGreaterThan(2);
    expect(centre.x).toBeLessThan(4);
  });

  it("is symmetric for a symmetric arrangement, and follows a removal", () => {
    const state = field(["gold", -1, 0, 0], ["wood", 0, 0, 0], ["gold", 1, 0, 0]);
    expect(value<{ centre: { x: number } }>(query("fieldMassCentre", state)).centre.x).toBeCloseTo(
      0,
      12,
    );
    const removed = { ...state, field: state.field.slice(0, 2) };
    expect(
      value<{ centre: { x: number } }>(query("fieldMassCentre", removed)).centre.x,
    ).toBeLessThan(0);
  });

  it("an empty field has no centre", () => {
    expect(query("fieldCentroid", field()).available).toBe(false);
    expect(query("fieldMassCentre", field()).available).toBe(false);
  });
});
