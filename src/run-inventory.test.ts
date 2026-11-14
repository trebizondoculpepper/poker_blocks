import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { getMaterialDefinition, materialOf, withMaterial } from "./materials";
import { removeCardForRun } from "./card-ownership";
import type { GameState } from "./game-state";
import { inventoryZones, runInventory } from "./run-inventory";

const state = (): GameState =>
  ({
    field: [{ block: standardDeck[0]!, cell: { x: 0, y: 0, z: 0 } }],
    hand: [standardDeck[1]!, standardDeck[2]!],
    deck: [standardDeck[3]!, standardDeck[4]!],
    discardPile: [standardDeck[5]!],
    passiveRack: [],
    coins: 0,
    round: { score: 0, targetScore: 0, movesLeft: 0, discardsLeft: 0 },
  }) as GameState;

describe("run inventory (#472)", () => {
  it("lists every live card once, with the zone it is in and that zone's order", () => {
    const records = runInventory(state());
    expect(records.map(({ card, zone }) => [card.id, zone])).toEqual([
      [standardDeck[3]!.id, "deck"],
      [standardDeck[4]!.id, "deck"],
      [standardDeck[1]!.id, "hand"],
      [standardDeck[2]!.id, "hand"],
      [standardDeck[0]!.id, "field"],
      [standardDeck[5]!.id, "discard"],
    ]);
    expect(records.find(({ zone }) => zone === "hand")?.label).toBe("in your hand");
    expect(new Set(records.map(({ card }) => card.id)).size).toBe(records.length);
  });

  it("shows each card's current material, and duplicates as separate instances", () => {
    const steel = withMaterial(standardDeck[3]!, getMaterialDefinition("steel"));
    const twin = { ...steel, id: `${steel.id}#2` };
    const records = runInventory({ ...state(), deck: [steel, twin] });
    const deck = records.filter(({ zone }) => zone === "deck");
    expect(deck).toHaveLength(2);
    expect(deck.map(({ card }) => materialOf(card))).toEqual(["steel", "steel"]);
  });

  it("leaves out a card removed from the run", () => {
    const removed = removeCardForRun(state(), standardDeck[1]!.id)!;
    expect(runInventory(removed).map(({ card }) => card.id)).not.toContain(standardDeck[1]!.id);
  });

  it("describes every zone with a label and a marker", () => {
    for (const name of inventoryZones.names()) {
      const zone = inventoryZones.get(name);
      expect(zone.label.length).toBeGreaterThan(0);
      expect(zone.icon.length).toBeGreaterThan(0);
    }
  });
});
