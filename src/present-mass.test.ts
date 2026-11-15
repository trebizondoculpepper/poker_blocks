import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { devOpaqueContainer } from "./dev-rankless-active";
import { fieldMass } from "./field-mass";
import { cardMassReading, getMaterialDefinition, withMaterial } from "./materials";
import "./playable-payload";

const wrap = "giftWrap" as never;
const present = (components: Record<string, unknown>) =>
  withMaterial(
    devOpaqueContainer("present.1", {
      id: "present.1.contents",
      definition: "playableCard",
      components,
    }),
    getMaterialDefinition(wrap),
  );
const ace = { rank: "A", suit: "hearts" };

describe("contents-derived Present mass (#1068)", () => {
  it("weighs exactly its stored card's material, with no wrapping surcharge", () => {
    expect(cardMassReading(present({ pokerIdentity: ace, material: "gold" }))).toEqual({
      kg: 19.32,
    });
    expect(cardMassReading(present({ pokerIdentity: ace, material: "wood" }))).toEqual({
      kg: 0.65,
    });
  });

  it("weighs a stored card with no material component as the default paper card", () => {
    const reading = cardMassReading(present({ pokerIdentity: ace }));
    expect(reading).toEqual(cardMassReading(standardDeck[0]!));
  });

  it("reads the descriptor without changing or opening it", () => {
    const block = present({ pokerIdentity: ace, material: "steel" });
    const before = structuredClone(block.traits.opaqueContainer);
    cardMassReading(block);
    expect(block.traits.opaqueContainer).toEqual(before);
  });

  it("is explicitly unavailable, never zero, without valid contents", () => {
    const empty = withMaterial(standardDeck[0]!, getMaterialDefinition(wrap));
    expect(cardMassReading(empty)).toEqual({ unavailable: "it holds no stored contents" });
    expect(cardMassReading(present({ pokerIdentity: ace, material: "giftWrap" }))).toEqual({
      unavailable: "its stored contents cannot nest",
    });
    expect(cardMassReading(present({ pokerIdentity: ace, material: "nonsense" }))).toEqual({
      unavailable: "its stored contents have an unknown material",
    });
  });

  it("counts once in the field total: the wrapper's resolved mass, not the payload again", () => {
    const field = [
      { block: present({ pokerIdentity: ace, material: "gold" }), cell: { x: 0, y: 0, z: 0 } },
      {
        block: withMaterial(standardDeck[1]!, getMaterialDefinition("wood")),
        cell: { x: 1, y: 0, z: 0 },
      },
    ];
    expect(fieldMass({ field } as never)).toMatchObject({ count: 2, totalKg: 19.32 + 0.65 });
    const broken = [
      {
        block: withMaterial(standardDeck[0]!, getMaterialDefinition(wrap)),
        cell: { x: 0, y: 0, z: 0 },
      },
    ];
    expect(fieldMass({ field: broken } as never)).toEqual({
      unavailable: "it holds no stored contents",
    });
  });
});
