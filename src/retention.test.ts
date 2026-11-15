import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { GameState } from "./game-state";
import { getMaterialDefinition, withMaterial } from "./materials";
import { expireRetained, retentionOf, retentionsEndingAfter } from "./retention";
import type { Retention } from "./lifecycle-resolver";

const card = (index: number, material: string) =>
  withMaterial(standardDeck[index]!, getMaterialDefinition(material as never));

function state(cards: Record<string, CardBlock[]>): GameState {
  return {
    field: (cards.field ?? []).map((block, x) => ({ block, cell: { x, y: 0, z: 0 } })),
    hand: cards.hand ?? [],
    deck: cards.deck ?? [],
    discardPile: cards.discard ?? [],
    passiveRack: [],
    coins: 0,
    round: { score: 0, targetScore: 0, movesLeft: 0, discardsLeft: 0 },
    cardStates: Object.fromEntries(
      Object.values(cards)
        .flat()
        .map(({ id }) => [id, { note: id }]),
    ),
  } as unknown as GameState;
}

describe("retention (#505; doc/clone-reset.md, 'Boundary lifecycle')", () => {
  it("resolves each card's retention from its definition's lifecycle", () => {
    expect(retentionOf(card(0, "wood"))).toBe("run");
    expect(retentionOf(card(1, "cloud"))).toBe("stage");
  });

  it("ends the stage's retention after any stage, and the round's too after its last", () => {
    expect(retentionsEndingAfter(false)).toEqual(["stage"]);
    expect(retentionsEndingAfter(true)).toEqual(["stage", "round"]);
  });

  it("expires stage-retained cards from every zone with their saved state, keeping the rest", () => {
    const [field, hand, deck, discard, keep] = [
      card(0, "cloud"),
      card(1, "cloud"),
      card(2, "cloud"),
      card(3, "cloud"),
      card(4, "wood"),
    ];
    const after = expireRetained(
      state({ field: [field, keep], hand: [hand], deck: [deck], discard: [discard] }),
      ["stage"],
    );
    expect(after.field.map(({ block }) => block.id)).toEqual([keep.id]);
    expect(after.hand).toEqual([]);
    expect(after.deck).toEqual([]);
    expect(after.discardPile).toEqual([]);
    expect(Object.keys(after.cardStates ?? {})).toEqual([keep.id]);
  });

  it("expires round-retained cards only when the round ends, and never run-retained ones", () => {
    const retention = (block: CardBlock): Retention =>
      block.id === standardDeck[0]!.id ? "round" : "run";
    const s = state({ deck: [standardDeck[0]!, standardDeck[1]!] });
    expect(expireRetained(s, ["stage"], retention).deck).toHaveLength(2);
    expect(expireRetained(s, ["stage", "round"], retention).deck.map(({ id }) => id)).toEqual([
      standardDeck[1]!.id,
    ]);
  });

  it("returns the same state when nothing expires", () => {
    const s = state({ deck: [card(0, "wood")] });
    expect(expireRetained(s, ["stage", "round"])).toBe(s);
    expect(expireRetained(s, [])).toBe(s);
  });
});
