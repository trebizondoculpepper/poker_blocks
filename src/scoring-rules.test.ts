import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { PlacedBlock } from "./game-state";
import { scoreFieldWithPassives } from "./passive-effects";
import { createPassiveBlock, type PassiveBlock } from "./passives";
import { ruleHandlers } from "./rule-handlers";
import type { BlockMaterial } from "./materials";

const card = (rank: string, suit: string, material?: BlockMaterial): CardBlock => {
  const base = standardDeck.find(
    (block) => block.traits.identity.rank === rank && block.traits.identity.suit.name === suit,
  )!;
  return material ? { ...base, traits: { ...base.traits, material: { kind: material } } } : base;
};
const row = (...blocks: CardBlock[]): PlacedBlock[] =>
  blocks.map((block, x) => ({ block, cell: { x, y: 0, z: 0 } }));
const passive = (name: string, index: number) => createPassiveBlock(name, `passive.${index}`);

describe("scoring passives run as event rules (#139)", () => {
  it("scores a test-only passive whose effect is registered in the test, with no scoring change", () => {
    ruleHandlers.registerEffect<{ value: number }, unknown>(
      "test-set-block-value",
      ({ value }, _selected, frame) => ({ ...frame, workingValue: value }),
    );
    const tens: PassiveBlock = {
      ...passive("double-line", 1),
      definitionId: "test-tens",
      traits: {
        ...passive("double-line", 1).traits,
        passive: {
          traitId: "passive.event-rules",
          eventRules: [
            {
              on: "score.beforeBlockValue",
              select: { id: "scored-block", config: {} },
              where: { id: "always", config: {} },
              effects: [{ id: "test-set-block-value", config: { value: 10 } }],
            },
          ],
        },
      },
    };
    // A pair of 3s: each 3 counts as 10, times the pair multiplier of 2.
    const [line] = scoreFieldWithPassives(row(card("3", "hearts"), card("3", "clubs")), [tens]);
    expect(line.points).toBe((10 + 10) * 2);
    expect(line.activations.map(({ passiveId, blockId }) => [passiveId, blockId])).toEqual([
      ["passive.1", line.contributingIds[0]],
      ["passive.1", line.contributingIds[1]],
    ]);
  });

  it("commits only the chosen hand's blocks in a long line, then the line's rules, once each", () => {
    // Six blocks: the best five-card hand is the straight 5–9, which leaves the wood 2 out.
    const field = row(
      card("2", "spades", "wood"),
      card("5", "hearts"),
      card("6", "clubs", "wood"),
      card("7", "hearts"),
      card("8", "diamonds"),
      card("9", "clubs"),
    );
    const rack = [passive("woodworker", 1), passive("double-line", 2), passive("long-haul", 3)];
    const [line] = scoreFieldWithPassives(field, rack);
    expect(line.hand).toBe("straight");
    const woodSix = field[2]!.block.id;
    expect(line.activations.map(({ passiveId, on, blockId }) => [passiveId, on, blockId])).toEqual([
      ["passive.1", "score.beforeBlockValue", woodSix],
      ["passive.2", "score.beforeLineFinalized", undefined],
      // Long Haul fires its three-or-more rule only, not the two-block penalty.
      ["passive.3", "score.beforeLineFinalized", undefined],
    ]);
    expect(line.points).toBe((5 + 9 + 7 + 8 + 9) * 3 * 2 + 5);
  });

  it("reports nothing when no rule matches", () => {
    const [line] = scoreFieldWithPassives(row(card("3", "hearts"), card("3", "clubs")), [
      passive("carnivore", 1),
    ]);
    expect(line.activations).toEqual([]);
  });

  it("keeps every passive's scoring rules serializable data", () => {
    for (const name of [
      "double-line",
      "quad-line",
      "carnivore",
      "woodworker",
      "crossroads",
      "long-haul",
    ]) {
      const rules = passive(name, 1).traits.passive.eventRules ?? [];
      expect(rules.length, name).toBeGreaterThan(0);
      expect(JSON.parse(JSON.stringify(rules)), name).toEqual(rules);
    }
  });
});
