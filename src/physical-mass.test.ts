import { describe, expect, it } from "vite-plus/test";
import { experimentalMaterials, materialDefinitions, type MaterialDefinition } from "./materials";
import { aggregateMass, massKg, validatePhysicalMass } from "./physical-mass";

/** doc/playfield-rocking.md, "Density calibration and full current catalogue". */
const catalogue: Record<string, number> = {
  paper: 0.016,
  wood: 0.65,
  steel: 7.85,
  prismatic: 2.5,
  gold: 19.32,
  earth: 0.873,
  terracotta: 1.8,
  ice: 0.917,
  meat: 1.05,
  fire: 0.678165,
  custard: 0.6255,
  gelato: 0.083,
  cloud: 0.04866,
  water: 0.598,
  magic: 0.0755,
  giftWrap: 0.0635,
  emptyVessel: 0.048,
  airVent: 0.15146,
  emptyLantern: 0.464,
  custardLantern: 1.0415,
  flameLantern: 0.464165,
  waterInLantern: 1.014,
  cloudInLantern: 0.46466,
  earthInLantern: 1.289,
  magicLockLantern: 0.4915,
  aggressiveFlame: 0.678165,
  custardFrame: 1.2555,
  waterInPlastic: 0.598,
  earthInPlastic: 0.873,
  hotWaterInPlastic: 0.598,
  boilingWaterInPlastic: 0.598,
  darkFluid: 0.543,
  cloudInPlastic: 0.04866,
  magicLock: 0.0755,
};

const all: readonly MaterialDefinition[] = [...materialDefinitions, ...experimentalMaterials];

describe("authored physical mass (#816)", () => {
  it("gives every installed definition a valid recipe", () => {
    expect(
      all.flatMap((definition) => validatePhysicalMass(definition.id, definition.mass)),
    ).toEqual([]);
  });

  it("matches the documented catalogue for every definition it lists", () => {
    for (const definition of all) {
      const expected = catalogue[definition.id];
      if (expected === undefined) continue;
      expect(massKg(definition.mass), definition.id).toBeCloseTo(expected, 9);
    }
    expect(Object.keys(catalogue).every((id) => all.some((d) => d.id === id))).toBe(true);
  });

  it("rejects missing, empty and non-positive recipes", () => {
    expect(validatePhysicalMass("x", undefined)).toHaveLength(1);
    expect(validatePhysicalMass("x", { components: [] })).toHaveLength(1);
    expect(
      validatePhysicalMass("x", { components: [{ name: "n", density: 0, volume: 1 }] }),
    ).toHaveLength(1);
    expect(validatePhysicalMass("x", { effective: 2, rationale: "" })).toHaveLength(1);
    expect(validatePhysicalMass("x", { effective: 2, rationale: "authored" })).toEqual([]);
  });

  it("totals, counts and averages a scope; an empty scope has no mean", () => {
    const byId = new Map(all.map((definition) => [definition.id, definition.mass]));
    const tenWood = Array.from({ length: 10 }, () => "wood");
    const wood = aggregateMass(tenWood, (id) => byId.get(id)!);
    expect(wood.totalKg).toBeCloseTo(6.5, 9);
    expect(wood.count).toBe(10);
    expect(wood.meanKg).toBeCloseTo(0.65, 9);
    expect(aggregateMass([] as string[], (id) => byId.get(id)!)).toEqual({
      totalKg: 0,
      count: 0,
      meanKg: null,
    });
  });
});

describe("field mass query (#816)", () => {
  it("counts only placed field blocks, by each card's current material", async () => {
    const { fieldMass } = await import("./field-mass");
    const { standardDeck } = await import("./cards");
    const { getMaterialDefinition, withMaterial } = await import("./materials");
    const steel = withMaterial(standardDeck[0]!, getMaterialDefinition("steel"));
    const wood = withMaterial(standardDeck[1]!, getMaterialDefinition("wood"));
    const state = {
      field: [
        { block: steel, cell: { x: 0, y: 0, z: 0 } },
        { block: wood, cell: { x: 1, y: 0, z: 0 } },
      ],
      hand: [withMaterial(standardDeck[2]!, getMaterialDefinition("gold"))],
      deck: [standardDeck[3]!],
      discardPile: [],
      passiveRack: [],
      coins: 0,
      round: { score: 0, targetScore: 0, movesLeft: 0, discardsLeft: 0 },
    };
    const mass = fieldMass(state as never);
    expect(mass.count).toBe(2);
    expect(mass.totalKg).toBeCloseTo(7.85 + 0.65, 9);
    expect(mass.meanKg).toBeCloseTo(4.25, 9);
    expect(fieldMass({ ...state, field: [] } as never).meanKg).toBeNull();
  });
});
