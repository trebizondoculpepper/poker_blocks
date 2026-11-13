import { describe, expect, it, vi } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { withDoneness } from "./cooking";
import type { GameState } from "./game-state";
import { getMaterialDefinition, materialOf, withMaterial } from "./materials";
import { requestReset, resetStateHandlers } from "./reset-facet";

function stateWith(card: CardBlock): GameState {
  return {
    field: [],
    hand: [card],
    deck: [standardDeck[10]!],
    discardPile: [],
    passiveRack: [],
    coins: 0,
    round: { score: 0, targetScore: 0, movesLeft: 0, discardsLeft: 0 },
    cardStates: { [card.id]: { doneness: 2, material: "meat" } },
  } as GameState;
}

const cookedMeat = (): CardBlock => {
  const meat = withMaterial(standardDeck[0]!, getMaterialDefinition("meat"));
  const cooked = withDoneness(meat, 2);
  return {
    ...cooked,
    traits: {
      ...cooked.traits,
      owner: { id: "shop" },
      countdown: { left: 1 },
      modifiers: { run: { additive: 3 } },
    },
  };
};

describe("resettable (#582)", () => {
  it("runs the configured recipe on one card, keeping identity, owner and run bonuses", () => {
    const card = cookedMeat();
    const random = vi.spyOn(Math, "random");
    const result = requestReset(stateWith(card), card.id, {
      facet: "resettable",
      config: { recipe: [{ handler: "doneness" }, { handler: "countdown" }] },
    });
    expect(result.ok).toBe(true);
    const reset = result.state.hand[0]!;
    expect(reset.id).toBe(card.id);
    expect(reset.traits.identity).toBe(card.traits.identity);
    expect(reset.traits.owner).toEqual({ id: "shop" });
    expect(reset.traits.modifiers).toEqual({ run: { additive: 3 } });
    expect(reset.traits.doneness).toBeUndefined();
    expect(reset.traits.countdown).toBeUndefined();
    expect(reset.traits.inspectable!.inspect()).toMatch(/Raw$/);
    // The saved doneness goes with it; the rest of the card's ledger entry stays.
    expect(result.state.cardStates).toEqual({ [card.id]: { material: "meat" } });
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it("leaves every other card, and the original state, unchanged", () => {
    const card = cookedMeat();
    const state = stateWith(card);
    const result = requestReset(state, card.id, {
      facet: "resettable",
      config: { recipe: [{ handler: "doneness" }] },
    });
    expect(result.state.deck[0]).toBe(state.deck[0]);
    expect(state.hand[0]).toBe(card);
    expect(card.traits.doneness).toEqual({ step: 2 });
  });

  it("is the same on repeat: resetting a reset card changes nothing more", () => {
    const card = cookedMeat();
    const request = { facet: "resettable", config: { recipe: [{ handler: "doneness" }] } };
    const once = requestReset(stateWith(card), card.id, request).state;
    const twice = requestReset(once, card.id, request);
    expect(twice.ok).toBe(true);
    const plain = ({ inspectable, ...traits }: CardBlock["traits"]) => ({
      ...traits,
      inspection: inspectable?.inspect(),
    });
    expect(plain(twice.state.hand[0]!.traits)).toEqual(plain(once.hand[0]!.traits));
    expect(twice.state.cardStates).toEqual(once.cardStates);
  });

  it("reverts to a configured material", () => {
    const gelato = withMaterial(standardDeck[2]!, getMaterialDefinition("gelato"));
    const result = requestReset(stateWith(gelato), gelato.id, {
      facet: "resettable",
      config: { recipe: [{ handler: "material", config: { to: "custard" } }] },
    });
    expect(result.ok).toBe(true);
    expect(materialOf(result.state.hand[0]!)).toBe("custard");
  });

  it("a failing step leaves the state exactly as it was", () => {
    const card = cookedMeat();
    const state = stateWith(card);
    const ran = vi.fn(() => null);
    resetStateHandlers.register("test.failing", ran);
    const failed = requestReset(state, card.id, {
      facet: "resettable",
      config: { recipe: [{ handler: "doneness" }, { handler: "test.failing" }] },
    });
    expect(failed.ok).toBe(false);
    expect(failed.state).toBe(state);
    expect(ran).toHaveBeenCalledTimes(1);
    const unknown = requestReset(state, card.id, {
      facet: "resettable",
      config: { recipe: [{ handler: "doneness" }, { handler: "no.such.handler" }] },
    });
    expect(unknown).toMatchObject({ ok: false, state });
    expect(requestReset(state, "missing", { facet: "resettable", config: {} }).ok).toBe(false);
  });
});
