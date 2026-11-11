import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { PlacedBlock } from "./game-state";
import { blockMaterials, getMaterialDefinition, type BlockMaterial } from "./materials";
import { scoreFieldWithPassives } from "./passive-effects";
import { createPassiveBlock } from "./passives";
import { validateScoringModifier } from "./scoring-modifier";

const card = (rank: string, suit: string, material?: BlockMaterial): CardBlock => {
  const base = standardDeck.find(
    (block) => block.traits.identity.rank === rank && block.traits.identity.suit.name === suit,
  )!;
  return material ? { ...base, traits: { ...base.traits, material: { kind: material } } } : base;
};
const row = (...blocks: CardBlock[]): PlacedBlock[] =>
  blocks.map((block, x) => ({ block, cell: { x, y: 0, z: 0 } }));
const points = (field: PlacedBlock[], rack = [] as ReturnType<typeof createPassiveBlock>[]) =>
  scoreFieldWithPassives(field, rack)[0]!.points;

describe("materials score through event rules (#141, doc/game.md worked examples)", () => {
  it("paper pair: 28", () => {
    expect(points(row(card("7", "hearts"), card("7", "clubs")))).toBe(28);
  });

  it("wood pair: (7+1) + (7+1) = 16, x2 = 32", () => {
    expect(points(row(card("7", "hearts", "wood"), card("7", "clubs", "wood")))).toBe(32);
  });

  it("adds Gold's point only when that card contributes", () => {
    const gold = card("7", "hearts", "gold");
    expect(points(row(gold, card("7", "clubs")))).toBe(30);
    const field = row(card("3", "spades", "gold"), card("7", "hearts"), card("7", "clubs"));
    expect(points(field)).toBe(28);
    expect(scoreFieldWithPassives(field, [])[0]!.activations).toEqual([]);
    expect(scoreFieldWithPassives(row(gold, card("7", "clubs")), [])[0]!.activations).toEqual([
      expect.objectContaining({ sourceId: gold.id, on: "score.beforeBlockValue" }),
    ]);
    expect(getMaterialDefinition("gold").activation).toMatchObject({
      effect: { id: "pulse" },
      sfx: "material.activate.gold",
    });
  });

  it("custard in a pair (#381): (7+2) + 7 = 16, x2 = 32, x1.2 = 38.4 -> 38", () => {
    expect(points(row(card("7", "hearts", "custard"), card("7", "clubs")))).toBe(38);
    // A custard card left out of the scored hand changes nothing.
    expect(
      points(row(card("3", "spades", "custard"), card("7", "hearts"), card("7", "clubs"))),
    ).toBe(28);
  });

  it("steel in a pair: 28 x 1.25 = 35", () => {
    expect(points(row(card("7", "hearts", "steel"), card("7", "clubs")))).toBe(35);
  });

  it("two steels: 28 x 1.25 x 1.25 = 43.75, rounded once to 44", () => {
    expect(points(row(card("7", "hearts", "steel"), card("7", "clubs", "steel")))).toBe(44);
  });

  it("crystal: 28 ^ 1.1 = 39.07, rounded to 39", () => {
    expect(points(row(card("7", "hearts", "prismatic"), card("7", "clubs")))).toBe(39);
  });

  it("a non-contributor has no effect: a steel 3 beside a pair of 7s", () => {
    const field = row(card("3", "spades", "steel"), card("7", "hearts"), card("7", "clubs"));
    expect(points(field)).toBe(28);
    expect(scoreFieldWithPassives(field, [])[0]!.activations).toEqual([]);
  });

  it("applies multipliers, then powers, then the rack's line effects (owner decision on #8)", () => {
    const double = [createPassiveBlock("double-line", "passive.1")];
    // Steel then crystal, in either line order: (28 x 1.25) ^ 1.1, then x2.
    const expected = Math.round((28 * 1.25) ** 1.1 * 2);
    expect(points(row(card("7", "hearts", "steel"), card("7", "clubs", "prismatic")), double)).toBe(
      expected,
    );
    expect(points(row(card("7", "hearts", "prismatic"), card("7", "clubs", "steel")), double)).toBe(
      expected,
    );
  });

  it("reports each contributing material as an activation from its card", () => {
    const steel = card("7", "hearts", "steel");
    const [line] = scoreFieldWithPassives(row(steel, card("7", "clubs")), []);
    expect(line!.activations.map(({ sourceId, on }) => [sourceId, on])).toEqual([
      [steel.id, "score.lineMultiply"],
    ]);
  });

  it("validates a scoring modifier's numbers", () => {
    expect(validateScoringModifier("bad", { additive: Number.NaN, multiplicative: 0 })).toEqual([
      "bad: additive must be a finite number",
      "bad: multiplicative must be positive",
    ]);
    expect(validateScoringModifier("bad", { exponential: -1 })).toEqual([
      "bad: exponential must be positive",
    ]);
  });

  it("never names a material in the scorer, the rule runner or the handlers", () => {
    const sources = import.meta.glob<string>(
      ["./passive-effects.ts", "./event-rules.ts", "./rule-handlers.ts", "./scoring.ts"],
      { query: "?raw", import: "default", eager: true },
    );
    for (const [path, source] of Object.entries(sources))
      for (const material of blockMaterials)
        expect(source.includes(`"${material}"`), `${path} names ${material}`).toBe(false);
  });
});
