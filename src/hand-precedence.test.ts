import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { PlacedBlock } from "./game-state";
import type { BlockMaterial } from "./materials";
import { scoreFieldWithPassives } from "./passive-effects";
import { createPassiveBlock } from "./passives";
import { evaluateLine } from "./scoring";

const card = (rank: string, suit: string, material?: BlockMaterial): CardBlock => {
  const base = standardDeck.find(
    (block) => block.traits.identity!.rank === rank && block.traits.identity!.suit.name === suit,
  )!;
  return material ? { ...base, traits: { ...base.traits, material: { kind: material } } } : base;
};
const row = (...blocks: CardBlock[]): PlacedBlock[] =>
  blocks.map((block, x) => ({ block, cell: { x, y: 0, z: 0 } }));

describe("long-line selection by hand precedence, then unmodified points (#1267; doc/game.md)", () => {
  it("prefers the stronger hand type even when a weaker one would score more", () => {
    // A low flush (2-4-6-8-10 hearts: 30×4 = 120) beats a high straight (9-K: 55×3 = 165).
    const line = [
      card("2", "hearts"),
      card("4", "hearts"),
      card("6", "hearts"),
      card("8", "hearts"),
      card("10", "hearts"),
      card("9", "spades"),
      card("J", "spades"),
      card("Q", "spades"),
      card("K", "spades"),
    ];
    const result = evaluateLine(line);
    expect(result.hand).toBe("flush");
    expect(result.points).toBe(120);
  });

  it("among the same hand type, takes the higher unmodified points", () => {
    const line = [
      card("K", "spades"),
      card("K", "hearts"),
      card("Q", "spades"),
      card("Q", "hearts"),
      card("Q", "clubs"),
      card("J", "spades"),
      card("J", "hearts"),
    ];
    const result = evaluateLine(line);
    expect(result.hand).toBe("full-house");
    // QQQKK: (12+12+12+13+13)×5 = 310.
    expect(result.points).toBe(310);
    expect(result.contributingIds).not.toContain("J-spades");
  });

  it("keeps the first subset in line order on an exact tie", () => {
    // Two straights of identical type and points (2-6 with either 6): the earlier subset wins.
    const line = [
      card("2", "spades"),
      card("3", "spades"),
      card("4", "spades"),
      card("5", "spades"),
      card("6", "hearts"),
      card("6", "clubs"),
    ];
    const result = evaluateLine(line);
    expect(result.hand).toBe("straight");
    expect(result.contributingIds).toContain("6-hearts");
    expect(result.contributingIds).not.toContain("6-clubs");
  });

  it("doesn't let modifiers change the chosen contributors (owner example)", () => {
    // Carnivore doubles each meat block's value. Meat Jacks would make QQQJJ outscore QQQKK if
    // modifiers took part in selection; they don't, so QQQKK is chosen and scores 310.
    const field = row(
      card("K", "spades"),
      card("K", "hearts"),
      card("Q", "spades"),
      card("Q", "hearts"),
      card("Q", "clubs"),
      card("J", "spades", "meat"),
      card("J", "hearts", "meat"),
    );
    const [line] = scoreFieldWithPassives(field, [createPassiveBlock("carnivore", "passive.1")]);
    expect(line!.hand).toBe("full-house");
    expect(line!.blockIds).toEqual(
      expect.arrayContaining(["K-spades", "K-hearts", "Q-spades", "Q-hearts", "Q-clubs"]),
    );
    expect(line!.points).toBe(310);
    // The unchosen meat Jacks don't activate the passive.
    expect(line!.activations.filter(({ on }) => on === "score.beforeBlockValue")).toEqual([]);
  });
});
