import { describe, expect, it } from "vite-plus/test";
import { createCard, standardDeck, type CardBlock } from "./cards";
import type { GameState, PlacedBlock } from "./game-state";
import { getMaterialDefinition, materialOf, withMaterial, type BlockMaterial } from "./materials";
import { applyReactions } from "./reactions";
import { withStateBonus } from "./state-bonuses";
import { ownerOf } from "./card-ownership";
import { rankAbove, spawnedIdentity } from "./pair-spawn";
import { cellKey, type Cell } from "./traits/attachable";

const card = (rank: string, suit: string, material: string, id = `${rank}-${suit}`) => {
  const base = standardDeck.find(
    (b) => b.traits.identity!.rank === rank && b.traits.identity!.suit.name === suit,
  )!;
  return withMaterial(
    createCard(base.traits.identity!, id),
    getMaterialDefinition(material as BlockMaterial),
  );
};
const boiling = (rank: string, suit: string) => withStateBonus(card(rank, suit, "water"), "boiled");
const at = (block: CardBlock, x: number, y = 0, z = 0): PlacedBlock => ({
  block,
  cell: { x, y, z } as Cell,
});
const table = (...field: PlacedBlock[]): GameState => ({
  field,
  hand: [],
  deck: [],
  discardPile: [],
  passiveRack: [],
  coins: 0,
  round: { score: 0, targetScore: 10, movesLeft: 5, discardsLeft: 3 },
});
const clouds = (state: GameState) =>
  state.field.filter(({ block }) => materialOf(block) === "cloud");

describe("air + boiling water makes a cloud (#425)", () => {
  it("places one cloud beyond the pair, on its axis, owned by the field", () => {
    const air = card("5", "hearts", "airVent");
    const water = boiling("9", "clubs");
    const after = applyReactions(table(at(air, 0), at(water, 1))).state;
    const made = clouds(after);
    expect(made).toHaveLength(1);
    expect(["-1,0,0", "2,0,0"]).toContain(
      `${made[0]!.cell.x},${made[0]!.cell.y},${made[0]!.cell.z}`,
    );
    expect(ownerOf(made[0]!.block)).toBe("field");
    expect(after.generatedCards?.map(({ id }) => id)).toEqual([made[0]!.block.id]);
    // The inputs are unchanged.
    expect(after.field[0]!.block).toEqual(air);
    expect(after.field[1]!.block).toEqual(water);
  });

  it("does nothing when both axis-end cells are taken, even if other neighbours are free", () => {
    const state = table(
      at(card("2", "spades", "paper", "left"), -1),
      at(card("5", "hearts", "airVent"), 0),
      at(boiling("9", "clubs"), 1),
      at(card("3", "spades", "paper", "right"), 2),
    );
    expect(clouds(applyReactions(state).state)).toHaveLength(0);
  });

  it("takes the free end when only one is free", () => {
    const state = table(
      at(card("2", "spades", "paper", "left"), -1),
      at(card("5", "hearts", "airVent"), 0),
      at(boiling("9", "clubs"), 1),
    );
    expect(cellKey(clouds(applyReactions(state).state)[0]!.cell)).toBe(
      cellKey({ x: 2, y: 0, z: 0 }),
    );
  });

  it("chooses the end whose lines score more when both are free", () => {
    // A 10 of diamonds sits above the cell beyond the air: a cloud of rank 10 there makes a pair.
    const state = table(
      at(card("5", "hearts", "airVent"), 0),
      at(boiling("9", "clubs"), 1),
      at(card("10", "diamonds", "paper", "above"), -1, 1),
    );
    const made = clouds(applyReactions(state).state)[0]!;
    expect(made.block.traits.identity!.rank).toBe("10");
    expect(cellKey(made.cell)).toBe(cellKey({ x: -1, y: 0, z: 0 }));
  });

  it("takes the higher input's suit and the rank above it, capped at Ace; ties take boiling water's suit", () => {
    expect(spawnedIdentity(card("5", "hearts", "airVent"), boiling("9", "clubs"))).toMatchObject({
      rank: "10",
      suit: { name: "clubs" },
    });
    expect(spawnedIdentity(card("K", "hearts", "airVent"), boiling("4", "clubs"))).toMatchObject({
      rank: "A",
      suit: { name: "hearts" },
    });
    expect(rankAbove("A")).toBe("A");
    expect(spawnedIdentity(card("7", "hearts", "airVent"), boiling("7", "clubs"))).toMatchObject({
      rank: "8",
      suit: { name: "clubs" },
    });
  });

  it("makes one cloud per play, and another on a later play while room remains", () => {
    const first = applyReactions(
      table(at(card("5", "hearts", "airVent"), 0), at(boiling("9", "clubs"), 1)),
    ).state;
    expect(clouds(first)).toHaveLength(1);
    const second = applyReactions(first).state;
    expect(clouds(second)).toHaveLength(2);
    expect(new Set(clouds(second).map(({ block }) => block.id)).size).toBe(2);
    // Both ends now taken: no third.
    expect(clouds(applyReactions(second).state)).toHaveLength(2);
  });

  it("needs boiling water: plain or hot water makes nothing", () => {
    const hot = withStateBonus(card("9", "clubs", "water"), "heated");
    expect(
      clouds(applyReactions(table(at(card("5", "hearts", "airVent"), 0), at(hot, 1))).state),
    ).toHaveLength(0);
  });

  it("ignores water that only boils this play: it reads the play's snapshot (#428 review)", () => {
    // Aggressive flame boils the water at x = -1 this play; it precedes the air in field order.
    const flame = withStateBonus(card("2", "diamonds", "fire"), "aggressive");
    const state = table(
      at(flame, -1, 1),
      at(card("6", "spades", "water", "soon"), -1),
      at(card("5", "hearts", "airVent"), 0),
      at(boiling("9", "clubs"), 1),
    );
    const after = applyReactions(state).state;
    expect(after.field.find(({ block }) => block.id === "soon")!.block.traits.stateBonus?.id).toBe(
      "boiled",
    );
    expect(clouds(after)).toHaveLength(1);
  });

  it("still spawns with a die in the rack, without throwing (#428 review)", async () => {
    const { createPassiveBlock } = await import("./passives");
    const state = {
      ...table(at(card("5", "hearts", "airVent"), 0), at(boiling("9", "clubs"), 1)),
      passiveRack: [createPassiveBlock("d6", "rack.d6")],
    };
    expect(clouds(applyReactions(state).state)).toHaveLength(1);
  });
});
