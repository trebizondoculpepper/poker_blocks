import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { GameState, PlacedBlock } from "./game-state";
import { materialOf, withMaterial, getMaterialDefinition, type BlockMaterial } from "./materials";
import { withStateBonus } from "./state-bonuses";
import { applyReactions, type Reaction } from "./reactions";
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
const run = (s: GameState) => applyReactions(s, reactionsFor);
const find = (s: GameState, id: string) => s.field.find(({ block }) => block.id === id)!.block;

describe("material reactions (#366)", () => {
  it("reacts across a shared face, keeping id, rank and suit", () => {
    const ice = made(0, "ice");
    const { state: next, applied } = run(state(at(ice, 0), at(made(1, "fire"), 1)));
    const melted = find(next, ice.id);
    expect(materialOf(melted)).toBe("wood");
    expect(melted.traits.stateBonus).toEqual({ id: "melted" });
    expect(melted.traits.identity!).toEqual(ice.traits.identity!);
    expect(applied).toEqual([
      {
        blockId: ice.id,
        from: { material: "ice" },
        to: { material: "wood", stateBonus: "melted" },
      },
    ]);
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

  it("reports a reaction only when it changes something (#400 review)", () => {
    // Wood beside steel takes "boiled"; on the next play it already has it, so nothing fires.
    const wood = made(2, "wood");
    const first = run(state(at(made(1, "steel"), 0), at(wood, 1)));
    expect(first.applied.map(({ blockId }) => blockId)).toEqual([wood.id]);
    expect(run(first.state).applied).toEqual([]);
  });

  it("ice melts into water +1 beside flame or hot water, keeping rank and suit (#367)", async () => {
    const ice = made(0, "ice");
    const beside = (neighbour: CardBlock) =>
      applyReactions(state(at(ice, 0), at(neighbour, 1))).state.field[0]!.block;
    for (const melted of [
      beside(made(1, "fire")),
      beside(withStateBonus(made(1, "water"), "heated")),
    ]) {
      expect(materialOf(melted)).toBe("water");
      expect(melted.traits.stateBonus).toEqual({ id: "melted" });
      expect(melted.traits.identity!).toEqual(ice.traits.identity!);
      expect(melted.id).toBe(ice.id);
    }
    // Plain (not hot) water, and a corner touch, leave ice alone.
    expect(materialOf(beside(made(1, "water")))).toBe("ice");
    expect(
      materialOf(
        applyReactions(state(at(ice, 0), at(made(1, "fire"), 1, 1))).state.field[0]!.block,
      ),
    ).toBe("ice");
  });

  it("flame heats water into hot water +1, replacing its old bonus; boiling water stays (#368)", () => {
    const heat = (water: CardBlock) =>
      applyReactions(state(at(water, 0), at(made(1, "fire"), 1))).state.field[0]!.block;
    const melted = withStateBonus(made(0, "water"), "melted");
    const hot = heat(melted);
    expect(materialOf(hot)).toBe("water");
    expect(hot.traits.stateBonus).toEqual({ id: "heated" });
    expect(hot.traits.identity!).toEqual(melted.traits.identity!);
    expect(heat(withStateBonus(made(0, "water"), "boiled")).traits.stateBonus).toEqual({
      id: "boiled",
    });
    // The flame itself is unchanged.
    const field = applyReactions(state(at(made(0, "water"), 0), at(made(1, "fire"), 1))).state
      .field;
    expect(materialOf(field[1]!.block)).toBe("fire");
  });

  it("air stokes flame into aggressive flame, the same card; air is unchanged (#370)", () => {
    const fire = made(1, "fire");
    const air = made(0, "airVent" as BlockMaterial);
    const field = applyReactions(state(at(air, 0), at(fire, 1))).state.field;
    const stoked = field[1]!.block;
    expect(materialOf(stoked)).toBe("fire");
    expect(stoked.traits.stateBonus).toEqual({ id: "aggressive" });
    expect(stoked.id).toBe(fire.id);
    expect(materialOf(field[0]!.block)).toBe("airVent");
  });

  it("aggressive flame boils water ×2, replacing its bonus; boiling water stays boiling (#369)", () => {
    const aggressive = withStateBonus(made(1, "fire"), "aggressive");
    const boil = (water: CardBlock) =>
      applyReactions(state(at(water, 0), at(aggressive, 1))).state.field[0]!.block;
    const boiled = boil(withStateBonus(made(0, "water"), "heated"));
    expect(boiled.traits.stateBonus).toEqual({ id: "boiled" });
    expect(materialOf(boiled)).toBe("water");
    // Boiled water beside ordinary flame stays boiled (#368's guard).
    const stays = applyReactions(state(at(boiled, 0), at(made(1, "fire"), 1))).state.field[0]!
      .block;
    expect(stays.traits.stateBonus).toEqual({ id: "boiled" });
  });

  it("water is never sold or unlocked: it only comes from reactions", async () => {
    const { getMaterialDefinition } = await import("./materials");
    expect(getMaterialDefinition("water").shop).toBeUndefined();
  });
});

describe("earth bakes into terracotta (#371)", () => {
  it("is a reaction on earth's definition: beside flame it becomes terracotta", async () => {
    const { getMaterialDefinition } = await import("./materials");
    expect(getMaterialDefinition("earth").reactions).toEqual([
      {
        when: { id: "neighbour-material", config: { material: "fire" } },
        results: [{ id: "transform", config: { material: "terracotta", sound: "reaction.bake" } }],
      },
    ]);
  });
});

describe("earth beside flame in play (#371 review)", () => {
  it("bakes into terracotta across a face, keeping the card; flame is unchanged", () => {
    const earth = made(0, "earth");
    const fire = made(1, "fire");
    const field = applyReactions(state(at(earth, 0), at(fire, 1))).state.field;
    const baked = field[0]!.block;
    expect(materialOf(baked)).toBe("terracotta");
    expect(baked.id).toBe(earth.id);
    expect(baked.traits.identity!).toEqual(earth.traits.identity!);
    expect(materialOf(field[1]!.block)).toBe("fire");
  });

  it("never bakes across an edge or a corner, nor beside anything but flame", () => {
    const earth = made(0, "earth");
    const after = (neighbour: PlacedBlock) =>
      materialOf(applyReactions(state(at(earth, 0), neighbour)).state.field[0]!.block);
    expect(after(at(made(1, "fire"), 1, 1))).toBe("earth");
    expect(after(at(made(1, "fire"), 1, 1, 1))).toBe("earth");
    expect(after(at(made(1, "wood"), 1))).toBe("earth");
  });

  it("terracotta, once baked, stays terracotta beside flame", () => {
    const baked = made(0, "terracotta");
    const field = applyReactions(state(at(baked, 0), at(made(1, "fire"), 1))).state.field;
    expect(materialOf(field[0]!.block)).toBe("terracotta");
  });
});
