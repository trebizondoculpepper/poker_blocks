import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { GameState, PlacedBlock } from "./game-state";
import { getMaterialDefinition, materialOf, withMaterial, type BlockMaterial } from "./materials";
import { applyReactions } from "./reactions";
import { resetRoundState } from "./round-end";
import type { Cell } from "./traits/attachable";
import "./card-material";

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
const first = (state: GameState) => materialOf(state.field[0]!.block);

describe("custard and gelato (#383)", () => {
  it("freezes custard beside ice into gelato, keeping its identity, rank and suit", () => {
    const custard = made(0, "custard");
    const after = applyReactions(table(at(custard, 0), at(made(1, "ice"), 1))).state;
    const gelato = after.field[0]!.block;
    expect(materialOf(gelato)).toBe("gelato");
    expect(gelato.id).toBe(custard.id);
    expect(gelato.traits.identity).toEqual(custard.traits.identity);
  });

  it("doesn't freeze custard while a source of heat is beside it too", () => {
    const state = table(at(made(0, "custard"), 0), at(made(1, "ice"), 1), at(made(2, "fire"), -1));
    expect(first(applyReactions(state).state)).toBe("custard");
  });

  it("thaws gelato beside heat back into custard, and doesn't refreeze it the same play", () => {
    const state = table(at(made(0, "gelato"), 0), at(made(1, "ice"), 1), at(made(2, "fire"), -1));
    const once = applyReactions(state).state;
    expect(first(once)).toBe("custard");
    // Heat is still beside it, so the ice can't freeze it next play either: no oscillation.
    expect(first(applyReactions(once).state)).toBe("custard");
  });

  it("keeps gelato without heat, even once the ice is gone", () => {
    const gelato = applyReactions(table(at(made(0, "custard"), 0), at(made(1, "ice"), 1))).state;
    const alone = { ...gelato, field: gelato.field.slice(0, 1) };
    expect(first(applyReactions(alone).state)).toBe("gelato");
  });

  it("scores +4 and ×1.5 in place of custard's +2 and ×1.2", () => {
    expect(getMaterialDefinition("gelato").scoringModifier).toEqual({
      additive: 4,
      multiplicative: 1.5,
    });
    expect(getMaterialDefinition("custard").scoringModifier).toEqual({
      additive: 2,
      multiplicative: 1.2,
    });
  });

  it("reverts every gelato card to custard at the end of the round, wherever it is", () => {
    const frozen = applyReactions(table(at(made(0, "custard"), 0), at(made(1, "ice"), 1))).state;
    const card = frozen.field[0]!.block;
    const scattered = { ...frozen, field: [], deck: [card], hand: [made(3, "gelato")] };
    const after = resetRoundState(scattered);
    expect(materialOf(after.deck[0]!)).toBe("custard");
    expect(materialOf(after.hand[0]!)).toBe("custard");
    expect(after.cardStates?.[card.id]?.material ?? "custard").toBe("custard");
  });

  it("is never sold: it is only made by a reaction", () => {
    expect(getMaterialDefinition("gelato").shop).toBeUndefined();
  });
});
