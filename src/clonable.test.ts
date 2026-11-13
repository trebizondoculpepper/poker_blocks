import { describe, expect, it, vi } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { cloneCard, cloneCodecs, UnsupportedCloneComponent } from "./clonable";
import { materialDefinitions, withMaterial } from "./materials";
import { getMaterialDefinition } from "./materials";

const busy = (base: CardBlock): CardBlock => ({
  ...base,
  traits: {
    ...base.traits,
    doneness: { step: 2 },
    countdown: { left: 3 },
    owner: { id: "shop" },
    stateBonus: { id: "melted" },
    modifiers: { run: { additive: 2 }, stage: { multiplicative: 1.5 } },
  },
});

describe("exact cloning (#581)", () => {
  it("makes an unplaced second instance in the same state, with a fresh ID", () => {
    const source = busy(withMaterial(standardDeck[3]!, getMaterialDefinition("wood")));
    const before = structuredClone({ ...source, traits: { ...source.traits, inspectable: null } });
    const allocate = vi.fn(() => "clone-1");
    const { clone, ids } = cloneCard(source, allocate);
    expect(clone.id).toBe("clone-1");
    expect(ids.get(source.id)).toBe("clone-1");
    expect(allocate).toHaveBeenCalledTimes(1);
    expect(clone.traits).toEqual(source.traits);
    // The source is untouched.
    expect({ ...source, traits: { ...source.traits, inspectable: null } }).toEqual(before);
  });

  it("copies instance state, so later changes to either never reach the other", () => {
    const source = busy(standardDeck[0]!);
    const { clone } = cloneCard(source, () => "c");
    expect(clone.traits.modifiers).not.toBe(source.traits.modifiers);
    expect(clone.traits.modifiers!.run).not.toBe(source.traits.modifiers!.run);
    (clone.traits.doneness as { step: number }).step = 5;
    (clone.traits.modifiers!.run as { additive: number }).additive = 9;
    expect(source.traits.doneness).toEqual({ step: 2 });
    expect(source.traits.modifiers!.run).toEqual({ additive: 2 });
  });

  it("shares immutable definition data by reference", () => {
    const source = withMaterial(standardDeck[0]!, getMaterialDefinition("wood"));
    const { clone } = cloneCard(source, () => "c");
    expect(clone.traits.identity).toBe(source.traits.identity);
    expect(clone.traits.attachable).toBe(source.traits.attachable);
    expect(clone.traits.inspectable).toBe(source.traits.inspectable);
  });

  it("refuses a trait with no clone codec before allocating anything", () => {
    const source = { ...standardDeck[0]!, traits: { ...standardDeck[0]!.traits, mystery: {} } };
    const allocate = vi.fn(() => "c");
    expect(() => cloneCard(source as CardBlock, allocate)).toThrow(UnsupportedCloneComponent);
    expect(allocate).not.toHaveBeenCalled();
  });

  it("clones a card of every registered material, and draws no random numbers", () => {
    const random = vi.spyOn(Math, "random");
    for (const definition of materialDefinitions) {
      const name = definition.id;
      const card = withMaterial(standardDeck[7]!, definition);
      for (const trait of Object.keys(card.traits)) expect(cloneCodecs.has(trait)).toBe(true);
      expect(cloneCard(card, () => `${name}-clone`).clone.traits).toEqual(card.traits);
    }
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
});
