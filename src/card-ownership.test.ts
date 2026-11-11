import { describe, expect, it } from "vite-plus/test";
import { createCard, standardDeck, type CardBlock } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { getMaterialDefinition, withMaterial } from "./materials";
import { demoRunRules } from "./run-rules";
import { fromSaveRecord, toSaveRecord } from "./save";
import { asGenerated, clearField, ownerOf } from "./card-ownership";
import type { GameState } from "./game-state";

const cloud = (): CardBlock =>
  asGenerated(
    withMaterial(
      createCard(standardDeck[5]!.traits.identity, "generated.cloud.1"),
      getMaterialDefinition("cloud"),
    ),
  );

/** A run state with a deck card and a generated cloud on the field. */
function withCloud(): GameState {
  const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
  const state = game.state;
  const own = state.deck[0]!;
  const made = cloud();
  return {
    ...state,
    deck: state.deck.slice(1),
    field: [
      { block: own, cell: { x: 0, y: 0, z: 0 } },
      { block: made, cell: { x: 1, y: 0, z: 0 } },
    ],
    generatedCards: [made],
  };
}

describe("generated field blocks (#424)", () => {
  it("are owned by the field; every other card by the deck", () => {
    expect(ownerOf(cloud())).toBe("field");
    expect(ownerOf(standardDeck[0]!)).toBe("deck");
  });

  it("leave play when the table clears, while deck cards go back to the deck", () => {
    const before = withCloud();
    const after = clearField(before);
    expect(after.field).toEqual([]);
    expect(after.deck.map(({ id }) => id)).toContain(before.field[0]!.block.id);
    expect(after.deck.map(({ id }) => id)).not.toContain("generated.cloud.1");
    expect(after.generatedCards).toBeUndefined();
    // Every starting card is still accounted for; nothing was added.
    expect(after.deck.length + after.hand.length + after.discardPile.length).toBe(
      before.deck.length + before.hand.length + before.discardPile.length + 1,
    );
  });

  it("survive save and Continue in full, still owned by the field", () => {
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
    const state = withCloud();
    const record = JSON.parse(JSON.stringify(toSaveRecord({ ...game.snapshot(), state })));
    const restored = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    expect(restored).not.toBeNull();
    const made = restored.state.field[1]!.block;
    expect(made.id).toBe("generated.cloud.1");
    expect(made.traits.material?.kind).toBe("cloud");
    expect(ownerOf(made)).toBe("field");
    expect(restored.state.generatedCards?.map(({ id }) => id)).toEqual(["generated.cloud.1"]);
    // And after Continue, clearing still keeps it out of the deck.
    expect(clearField(restored.state).deck.map(({ id }) => id)).not.toContain("generated.cloud.1");
  });

  it("takes a cleared card's saved state with it, so the next save still loads (#427 review)", async () => {
    const { setCardStateBonus } = await import("./state-bonuses");
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
    const bonused = setCardStateBonus(withCloud(), "generated.cloud.1", "heated")!;
    expect(bonused.cardStates?.["generated.cloud.1"]).toBeDefined();
    const cleared = clearField(bonused);
    expect(cleared.cardStates?.["generated.cloud.1"]).toBeUndefined();
    const record = JSON.parse(JSON.stringify(toSaveRecord({ ...game.snapshot(), state: cleared })));
    expect(fromSaveRecord(record, standardDeck, dealerRegistry)).not.toBeNull();
  });
});
