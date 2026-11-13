import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { PlacedBlock } from "./game-state";
import { getMaterialDefinition, type BlockMaterial } from "./materials";
import { scoreFieldWithPassives } from "./passive-effects";
import { handMultipliers } from "./scoring";

const card = (rank: string, suit: string, material?: BlockMaterial): CardBlock => {
  const base = standardDeck.find(
    (block) => block.traits.identity!.rank === rank && block.traits.identity!.suit.name === suit,
  )!;
  return material ? { ...base, traits: { ...base.traits, material: { kind: material } } } : base;
};
const row = (...blocks: CardBlock[]): PlacedBlock[] =>
  blocks.map((block, x) => ({ block, cell: { x, y: 0, z: 0 } }));
const scored = (field: PlacedBlock[]) => scoreFieldWithPassives(field, [])[0]!;

describe("cloud scoring (#423)", () => {
  it("enhances a pair it isn't part of: (28 + 2×2) × 1.5 = 48, still a pair", () => {
    const line = scored(row(card("7", "hearts"), card("7", "clubs"), card("3", "spades", "cloud")));
    expect(line.hand).toBe("pair");
    expect(line.points).toBe(48);
  });

  it("keeps a high card a high card, but worth more: it is not a wildcard", () => {
    const plain = scored(row(card("9", "hearts"), card("3", "spades")));
    const cloudy = scored(row(card("9", "hearts"), card("3", "spades", "cloud")));
    expect(cloudy.hand).toBe("high-card");
    expect(cloudy.points).toBe(Math.round((plain.points + 2 * handMultipliers["high-card"]) * 1.5));
  });

  it("stacks: two clouds compose their multipliers, ×2.25", () => {
    const line = scored(
      row(
        card("7", "hearts"),
        card("7", "clubs"),
        card("3", "spades", "cloud"),
        card("4", "diamonds", "cloud"),
      ),
    );
    expect(line.hand).toBe("pair");
    expect(line.points).toBe(Math.round((28 + 4 + 4) * 2.25));
  });

  it("leaves every other material contributing only when chosen (Gold's point unchanged)", () => {
    const line = scored(row(card("3", "spades", "gold"), card("7", "hearts"), card("7", "clubs")));
    expect(line.points).toBe(28);
  });

  it("is never sold: clouds are only made by a reaction", () => {
    expect(getMaterialDefinition("cloud").shop).toBeUndefined();
    expect(getMaterialDefinition("cloud").scoringEligibility).toBe("rowPresence");
  });

  it("can't take high card with its bonus: paper 9 and cloud 8 is (9 + 2) × 1.5 = 17 (#426 review)", () => {
    const line = scored(row(card("9", "hearts"), card("8", "spades", "cloud")));
    expect(line.hand).toBe("high-card");
    expect(line.points).toBe(Math.round((9 + 2 * handMultipliers["high-card"]) * 1.5));
    // A higher cloud never lowers the score.
    const lower = scored(row(card("9", "hearts"), card("7", "spades", "cloud")));
    expect(line.points).toBeGreaterThanOrEqual(lower.points);
  });

  it("counts its bonus once when it is the hand's own card", () => {
    const line = scored(row(card("7", "hearts", "cloud"), card("7", "clubs")));
    expect(line.hand).toBe("pair");
    expect(line.points).toBe(Math.round((7 + 7 + 2) * 2 * 1.5));
  });
});
