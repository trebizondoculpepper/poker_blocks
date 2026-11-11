import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { GameState, PlacedBlock } from "./game-state";
import { getMaterialDefinition, withMaterial, type BlockMaterial } from "./materials";
import { applyReactions } from "./reactions";
import { withStateBonus } from "./state-bonuses";
import { resetDoneness, withDoneness } from "./cooking";
import { applyCardStates } from "./card-states";
import type { Cell } from "./traits/attachable";

const made = (index: number, material: BlockMaterial): CardBlock =>
  withMaterial(standardDeck[index]!, getMaterialDefinition(material));
const at = (block: CardBlock, x: number, y = 0): PlacedBlock => ({
  block,
  cell: { x, y, z: 0 } as Cell,
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
const meatOf = (state: GameState) => state.field[0]!.block;

describe("cooking (#372)", () => {
  it("advances meat one step per play beside flame, stopping at Overcooked", () => {
    let state = table(at(made(0, "meat"), 0), at(made(1, "fire"), 1));
    const seen: (number | undefined)[] = [];
    for (let play = 0; play < 7; play++) {
      state = applyReactions(state).state;
      seen.push(meatOf(state).traits.doneness?.step);
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 5, 5]);
    expect(meatOf(state).traits.inspectable?.inspect()).toContain("Overcooked");
  });

  it("cooks beside boiling water but not hot water, and one step even beside two sources", () => {
    const meat = made(0, "meat");
    const boiling = withStateBonus(made(1, "water"), "boiled");
    const hot = withStateBonus(made(1, "water"), "heated");
    expect(
      meatOf(applyReactions(table(at(meat, 0), at(boiling, 1))).state).traits.doneness,
    ).toEqual({ step: 1 });
    expect(
      meatOf(applyReactions(table(at(meat, 0), at(hot, 1))).state).traits.doneness,
    ).toBeUndefined();
    const both = table(at(meat, 0), at(made(1, "fire"), 1), at(boiling, 0, 1));
    expect(meatOf(applyReactions(both).state).traits.doneness).toEqual({ step: 1 });
  });

  it("is saved with the card states and returns to Raw when a stage ends", () => {
    const cooked = applyReactions(table(at(made(0, "meat"), 0), at(made(1, "fire"), 1))).state;
    const id = meatOf(cooked).id;
    expect(cooked.cardStates?.[id]).toEqual({ doneness: 1 });
    expect(applyCardStates(made(0, "meat"), cooked.cardStates).traits.doneness).toEqual({
      step: 1,
    });
    const reset = resetDoneness(cooked);
    expect(meatOf(reset).traits.doneness).toBeUndefined();
    expect(reset.cardStates).toBeUndefined();
    expect(meatOf(reset).traits.inspectable?.inspect()).not.toContain("Bloody");
  });

  it("names its step in the inspector", () => {
    expect(withDoneness(made(0, "meat"), 3).traits.inspectable?.inspect()).toMatch(
      /· Meat · Medium Rare$/,
    );
  });
});

describe("doneness resets through the stage-end registry (#408 review)", () => {
  it("is registered, and the run's reset clears it", async () => {
    const { stageEndResets, resetStageState } = await import("./stage-end");
    expect(stageEndResets.has("doneness")).toBe(true);
    const cooked = applyReactions(table(at(made(0, "meat"), 0), at(made(1, "fire"), 1))).state;
    expect(meatOf(resetStageState(cooked)).traits.doneness).toBeUndefined();
  });
});

describe("the inspector names Raw too (#408 review)", () => {
  it("shows Raw on fresh meat and after the stage reset", () => {
    expect(made(0, "meat").traits.inspectable?.inspect()).toMatch(/· Meat · Raw$/);
    const cooked = applyReactions(table(at(made(0, "meat"), 0), at(made(1, "fire"), 1))).state;
    expect(meatOf(resetDoneness(cooked)).traits.inspectable?.inspect()).toMatch(/· Meat · Raw$/);
    // Other materials have no doneness step.
    expect(made(0, "wood").traits.inspectable?.inspect()).toMatch(/· Wood$/);
  });
});

describe("a material change clears doneness (#408 review)", () => {
  it("transmogrified cooked meat forgets its step, on the card and in the ledger", async () => {
    const { changeCardMaterial } = await import("./card-material");
    const cooked = applyReactions(table(at(made(0, "meat"), 0), at(made(1, "fire"), 1))).state;
    const id = meatOf(cooked).id;
    const wood = changeCardMaterial(cooked, id, "wood")!;
    expect(meatOf(wood).traits.doneness).toBeUndefined();
    expect(wood.cardStates?.[id]).toEqual({ material: "wood" });
    const back = changeCardMaterial(wood, id, "meat")!;
    expect(meatOf(back).traits.inspectable?.inspect()).toMatch(/· Meat · Raw$/);
    expect(meatOf(back).traits.doneness).toBeUndefined();
  });
});
