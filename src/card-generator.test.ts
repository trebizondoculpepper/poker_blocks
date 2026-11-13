import { describe, expect, it, vi } from "vite-plus/test";
import { ranks, suits } from "./cards";
import {
  cardDistributions,
  EmptyGenerationPool,
  generateCard,
  generationEligibilities,
  progressionQueries,
  type CardGeneration,
} from "./card-generator";
import { getMaterialDefinition, materialOf } from "./materials";

const present: CardGeneration = {
  distribution: "shopPlayableCards",
  progression: "nextRound",
  eligibility: "payload",
};

/** A seeded stream, so a test can repeat a generation exactly. */
const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

describe("shared card generator (#555)", () => {
  it("uses the next round's table, clamped to a configured final round", () => {
    const next = progressionQueries.get("nextRound");
    expect(next(2, undefined)).toBe(3);
    expect(next(8, { finalRound: 8 })).toBe(8);
    expect(next(3, { finalRound: 8 })).toBe(4);
  });

  it("draws material, rank and suit once each from the seeded stream, in that order", () => {
    const random = vi.fn(seeded(11));
    let ids = 0;
    const card = generateCard(present, 1, random, () => `present-${++ids}`);
    expect(random).toHaveBeenCalledTimes(3);
    expect(card.id).toBe("present-1");
    // The same seed makes the same card: a saved stream position reproduces it.
    const again = generateCard(present, 1, seeded(11), () => "x");
    expect(again.traits.identity).toEqual(card.traits.identity);
    expect(materialOf(again)).toBe(materialOf(card));
  });

  it("only produces eligible materials with weight in the chosen table", () => {
    const table = cardDistributions.get("shopPlayableCards")(2);
    const allowed = new Set(
      table
        .filter(({ material, weight }) => weight > 0 && material.payloadEligible !== false)
        .map(({ material }) => material.id),
    );
    const random = seeded(3);
    for (let n = 0; n < 300; n++)
      expect(allowed.has(materialOf(generateCard(present, 1, random, () => "c")))).toBe(true);
    // Paper is never inside a Present, whatever its shop weight; any other material may be.
    const payload = generationEligibilities.get("payload");
    expect(payload(getMaterialDefinition("paper"))).toBe(false);
    expect(payload(getMaterialDefinition("wood"))).toBe(true);
    expect(allowed.has("paper")).toBe(false);
  });

  it("reaches every rank and suit, without favouring any", () => {
    const random = seeded(5);
    const seen = new Map<string, number>();
    for (let n = 0; n < 5200; n++) {
      const { rank, suit } = generateCard(present, 1, random, () => "c").traits.identity;
      seen.set(`${rank}${suit.name}`, (seen.get(`${rank}${suit.name}`) ?? 0) + 1);
    }
    expect(seen.size).toBe(ranks.length * suits.length);
    for (const count of seen.values()) expect(count).toBeGreaterThan(50);
  });

  it("fails before drawing or allocating when nothing is eligible", () => {
    generationEligibilities.register("test.none", () => false);
    const random = vi.fn(Math.random);
    const allocate = vi.fn(() => "c");
    expect(() =>
      generateCard({ ...present, eligibility: "test.none" }, 1, random, allocate),
    ).toThrow(EmptyGenerationPool);
    expect(random).not.toHaveBeenCalled();
    expect(allocate).not.toHaveBeenCalled();
  });
});
