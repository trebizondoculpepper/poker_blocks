import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import type { PlacedBlock } from "./game-state";
import { scoreFieldWithPassives } from "./passive-effects";
import { demoRunRules } from "./run-rules";
import { fromSaveRecord, toSaveRecord } from "./save";
import { validateStateBonuses, withStateBonus } from "./state-bonuses";

const card = (rank: string, suit: string): CardBlock =>
  standardDeck.find(
    ({ traits }) => traits.identity!.rank === rank && traits.identity!.suit.name === suit,
  )!;
const row = (...blocks: CardBlock[]): PlacedBlock[] =>
  blocks.map((block, x) => ({ block, cell: { x, y: 0, z: 0 } }));
const points = (field: PlacedBlock[]) => scoreFieldWithPassives(field, [])[0]!.points;

describe("state bonuses (#365)", () => {
  it("has valid registered amounts", () => {
    expect(validateStateBonuses()).toEqual([]);
  });

  it("adds through the card's own scoring rules, leaving rank, suit and hand alone", () => {
    const melted = withStateBonus(card("7", "hearts"), "melted");
    expect(melted.traits.identity!).toEqual(card("7", "hearts").traits.identity!);
    // (7+1) + 7 = 15, x2 pair = 30.
    expect(points(row(melted, card("7", "clubs")))).toBe(30);
    expect(scoreFieldWithPassives(row(melted, card("7", "clubs")), [])[0]!.hand).toBe(
      scoreFieldWithPassives(row(card("7", "hearts"), card("7", "clubs")), [])[0]!.hand,
    );
  });

  it("multiplies the whole line and stacks multiplicatively (assumption on #365)", () => {
    const boiled = withStateBonus(card("7", "hearts"), "boiled");
    expect(points(row(boiled, card("7", "clubs")))).toBe(56);
    expect(points(row(boiled, withStateBonus(card("7", "clubs"), "boiled")))).toBe(112);
  });

  it("replaces the old state rather than stacking both", () => {
    const upgraded = withStateBonus(withStateBonus(card("7", "hearts"), "heated"), "boiled");
    expect(upgraded.traits.stateBonus).toEqual({ id: "boiled" });
    expect(points(row(upgraded, card("7", "clubs")))).toBe(56);
  });

  it("does nothing on a card outside the scored hand", () => {
    const field = row(
      withStateBonus(card("3", "spades"), "boiled"),
      card("7", "hearts"),
      card("7", "clubs"),
    );
    expect(points(field)).toBe(28);
  });

  it("survives save and Continue alongside a material change, and rejects an unknown bonus", () => {
    const run = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0);
    const target = run.state.hand[0]!;
    run.changeCardMaterial(target.id, "steel");
    expect(run.setCardStateBonus(target.id, "heated")).not.toBeNull();
    expect(run.setCardStateBonus(target.id, "heated")).toBeNull();
    const record = JSON.parse(JSON.stringify(toSaveRecord(run.snapshot())));
    expect(record.state.cardStates[target.id]).toEqual({ material: "steel", stateBonus: "heated" });
    const restored = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    const back = restored.state.hand.find(({ id }) => id === target.id)!;
    expect(back.traits.stateBonus).toEqual({ id: "heated" });
    expect(back.traits.material).toEqual({ kind: "steel" });
    const bad = structuredClone(record);
    bad.state.cardStates[target.id].stateBonus = "frozen-solid";
    expect(fromSaveRecord(bad, standardDeck, dealerRegistry)).toBeNull();
  });
});
