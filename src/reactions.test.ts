import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { GameState, PlacedBlock } from "./game-state";
import { materialOf, withMaterial, getMaterialDefinition, type BlockMaterial } from "./materials";
import { resolveReactions, type Reaction } from "./reactions";
import type { Cell } from "./traits/attachable";

const made = (index: number, material: BlockMaterial): CardBlock =>
  withMaterial(standardDeck[index]!, getMaterialDefinition(material));
const at = (block: CardBlock, x: number, y = 0, z = 0): PlacedBlock => ({
  block,
  cell: { x, y, z } as Cell,
});
const state = (...field: PlacedBlock[]): GameState => ({
  field,
  hand: [],
  deck: [],
  discardPile: [],
  passiveRack: [],
  coins: 0,
  round: { score: 0, targetScore: 10, movesLeft: 5, discardsLeft: 3 },
});

// Test recipes, given to the resolver directly: ice beside fire melts into water; air beside
// fire makes it aggressive (here: steel stands in for "aggressive flame" and wood for water).
const recipes: Partial<Record<BlockMaterial, readonly Reaction[]>> = {
  ice: [
    {
      when: { id: "neighbour-material", config: { material: "fire" } },
      results: [{ id: "transform", config: { material: "wood", stateBonus: "melted" } }],
    },
  ],
  fire: [
    {
      when: { id: "neighbour-material", config: { material: "terracotta" } },
      results: [{ id: "transform", config: { material: "steel" } }],
    },
  ],
  wood: [
    {
      when: { id: "neighbour-material", config: { material: "steel" } },
      results: [{ id: "transform", config: { stateBonus: "boiled" } }],
    },
  ],
};
const reactionsFor = (block: CardBlock) => recipes[materialOf(block)] ?? [];
const run = (s: GameState) => resolveReactions(s, reactionsFor);
const find = (s: GameState, id: string) => s.field.find(({ block }) => block.id === id)!.block;

describe("material reactions (#366)", () => {
  it("reacts across a shared face, keeping id, rank and suit", () => {
    const ice = made(0, "ice");
    const { state: next, applied } = run(state(at(ice, 0), at(made(1, "fire"), 1)));
    const melted = find(next, ice.id);
    expect(materialOf(melted)).toBe("wood");
    expect(melted.traits.stateBonus).toEqual({ id: "melted" });
    expect(melted.traits.identity).toEqual(ice.traits.identity);
    expect(applied.map(({ blockId }) => blockId)).toEqual([ice.id]);
  });

  it("never reacts across an edge or a corner", () => {
    const ice = made(0, "ice");
    for (const fire of [at(made(1, "fire"), 1, 1), at(made(1, "fire"), 1, 1, 1)]) {
      const { applied } = run(state(at(ice, 0), fire));
      expect(applied).toEqual([]);
    }
  });

  it("does nothing for an unconfigured pair", () => {
    const { state: next, applied } = run(state(at(made(0, "gold"), 0), at(made(1, "fire"), 1)));
    expect(applied).toEqual([]);
    expect(materialOf(next.field[0]!.block)).toBe("gold");
  });

  it("takes a chain one step per play: no cascade within a play", () => {
    // terracotta turns fire to steel; steel then boils wood, but only on the next play.
    const fire = made(1, "fire");
    const wood = made(2, "wood");
    const first = run(state(at(made(0, "terracotta"), 0), at(fire, 1), at(wood, 2)));
    expect(materialOf(find(first.state, fire.id))).toBe("steel");
    expect(find(first.state, wood.id).traits.stateBonus).toBeUndefined();
    const second = run(first.state);
    expect(find(second.state, wood.id).traits.stateBonus).toEqual({ id: "boiled" });
  });

  it("selects the same reactions whatever order the field is listed in", () => {
    const pieces = [at(made(0, "terracotta"), 0), at(made(1, "fire"), 1), at(made(2, "ice"), 2)];
    const forward = run(state(...pieces))
      .applied.map(({ blockId }) => blockId)
      .sort();
    const backward = run(state(...pieces.toReversed()))
      .applied.map(({ blockId }) => blockId)
      .sort();
    expect(backward).toEqual(forward);
  });

  it("no gameplay material reacts yet: reactions arrive with #367–#371", async () => {
    const { materialDefinitions } = await import("./materials");
    expect(materialDefinitions.filter((material) => "reactions" in material)).toEqual([]);
  });
});
