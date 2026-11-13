import { describe, expect, it } from "vite-plus/test";
import { cloneCard } from "./clonable";
import { devOpaqueContainer } from "./dev-rankless-active";
import type { GameState } from "./game-state";
import { resetClone } from "./reset-facet";
import "./playable-payload";

const king = (id: string) => ({
  id,
  definition: "playableCard",
  components: { pokerIdentity: { rank: "K", suit: "hearts" }, material: "wood" },
});
const counter = () => {
  let next = 0;
  const allocate = () => `fresh-${++next}`;
  return { allocate, count: () => next };
};

describe("cloning a container's nested payload (#929)", () => {
  it("gives the clone fresh wrapper and payload IDs with the same hidden content", () => {
    const source = devOpaqueContainer("box", king("inside"));
    const { clone, ids } = cloneCard(source, counter().allocate);
    const payload = clone.traits.opaqueContainer!.payload;
    expect(clone.id).not.toBe("box");
    expect(payload.id).not.toBe("inside");
    expect(new Set([clone.id, payload.id]).size).toBe(2);
    expect(ids).toEqual(
      new Map([
        ["inside", payload.id],
        ["box", clone.id],
      ]),
    );
    // Same content, never rerolled.
    expect({ ...payload, id: "inside" }).toEqual(king("inside"));
  });

  it("never aliases the source's mutable payload state", () => {
    const source = devOpaqueContainer("box", king("inside"));
    const { clone } = cloneCard(source, counter().allocate);
    const copied = clone.traits.opaqueContainer!.payload;
    expect(copied.components).not.toBe(source.traits.opaqueContainer!.payload.components);
    (copied.components.pokerIdentity as { rank: string }).rank = "Q";
    expect(source.traits.opaqueContainer!.payload.components.pokerIdentity).toEqual({
      rank: "K",
      suit: "hearts",
    });
  });

  it("refuses an invalid payload before allocating any ID", () => {
    const broken = devOpaqueContainer("box", { ...king("inside"), components: {} });
    const ids = counter();
    expect(() => cloneCard(broken, ids.allocate)).toThrow(/missing component/);
    expect(ids.count()).toBe(0);
  });

  it("refuses a payload that shares its wrapper's ID", () => {
    const ids = counter();
    expect(() => cloneCard(devOpaqueContainer("box", king("box")), ids.allocate)).toThrow(
      /container's ID/,
    );
    expect(ids.count()).toBe(0);
  });

  it("allocates nothing when a later trait cannot be cloned", () => {
    const source = devOpaqueContainer("box", king("inside"));
    const odd = {
      ...source,
      // A copied component holding a non-plain object: refused by its codec.
      traits: { ...source.traits, modifiers: new Map() },
    } as unknown as typeof source;
    const ids = counter();
    expect(() => cloneCard(odd, ids.allocate)).toThrow();
    expect(ids.count()).toBe(0);
  });

  it("reset-clones through the reset facet, keeping the fixed payload", () => {
    const source = devOpaqueContainer("box", king("inside"));
    const state = { hand: [source], deck: [], discardPile: [], field: [] } as unknown as GameState;
    const kept = resetClone(
      state,
      "box",
      { facet: "resettable", config: { recipe: [] } },
      counter().allocate,
    );
    expect(kept.ok && { ...kept.clone.traits.opaqueContainer!.payload, id: "inside" }).toEqual(
      king("inside"),
    );
    const refused = resetClone(
      state,
      "box",
      { facet: "nonResettable", config: { reason: "opening is separate" } },
      counter().allocate,
    );
    expect(refused).toEqual({ ok: false, reason: "opening is separate" });
  });
});
