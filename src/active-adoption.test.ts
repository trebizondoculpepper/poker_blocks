import { describe, expect, it } from "vite-plus/test";
import { adoptStoredPayload, takenIdentities } from "./active-adoption";
import { clearField, removeCardForRun } from "./card-ownership";
import { standardDeck, type CardBlock } from "./cards";
import { dealerRegistry } from "./dealer";
import { devOpaqueContainer } from "./dev-rankless-active";
import { GameRun } from "./game-run";
import { demoRunRules, sandboxRunRules } from "./run-rules";
import { fromSaveRecord, toSaveRecord } from "./save";

const king = (id: string) => ({
  id,
  definition: "playableCard",
  components: { pokerIdentity: { rank: "K", suit: "hearts" } },
});

/** A run whose field holds this wrapper at (0,0,0), with every standard card in the deck. */
function runWith(wrapper: CardBlock, zone: "field" | "hand" = "field") {
  const rules = sandboxRunRules(demoRunRules);
  const opening = new GameRun(dealerRegistry, rules, standardDeck, () => 0);
  return GameRun.fromSnapshot(
    dealerRegistry,
    rules,
    standardDeck,
    {
      ...opening.snapshot(),
      state: {
        ...opening.state,
        hand: zone === "hand" ? [wrapper] : [],
        field: zone === "field" ? [{ block: wrapper, cell: { x: 0, y: 0, z: 0 } }] : [],
        deck: standardDeck,
      },
    },
    () => 0,
  );
}

describe("adopting a stored payload into the run (#928)", () => {
  it("keeps the stored payload out of every live zone until it is adopted", () => {
    const run = runWith(devOpaqueContainer("box", king("inside")));
    expect(takenIdentities(run.state).has("inside")).toBe(false);
  });

  it("puts the payload in the wrapper's own cell and retires the wrapper", () => {
    const run = runWith(devOpaqueContainer("box", king("inside")));
    const adopted = adoptStoredPayload(run.state, "box");
    expect(adopted.ok).toBe(true);
    if (!adopted.ok) return;
    expect(adopted.state.field).toEqual([{ block: adopted.payload, cell: { x: 0, y: 0, z: 0 } }]);
    expect(adopted.payload.traits.identity?.rank).toBe("K");
    expect(adopted.payload.traits.owner).toEqual({ id: "runActive" });
    // Placed: not selectable, like any block on the field.
    expect(adopted.state.field[0]!.block.traits.selectable).toBeUndefined();
    expect(adopted.state.removedCards).toEqual(["box"]);
    expect(adopted.state.retiredActives?.map(({ id }) => id)).toEqual(["box"]);
  });

  it("adopts in place in the hand too", () => {
    const run = runWith(devOpaqueContainer("box", king("inside")), "hand");
    const adopted = adoptStoredPayload(run.state, "box");
    expect(adopted.ok && adopted.state.hand.map(({ id }) => id)).toEqual(["inside"]);
  });

  it("refuses a payload whose identity is taken, changing nothing", () => {
    const clash = devOpaqueContainer("box", king(standardDeck[0]!.id));
    const run = runWith(clash);
    expect(adoptStoredPayload(run.state, "box")).toEqual({
      ok: false,
      reason: `payload ID ${standardDeck[0]!.id} is already in use`,
    });
    expect(adoptStoredPayload(run.state, "nope")).toMatchObject({ ok: false });
  });

  it("gives any adopted payload run ownership, so its removal is retired and saved", () => {
    const rankless = { id: "inside", definition: "devRanklessActive", components: {} };
    const run = runWith(devOpaqueContainer("box", rankless));
    const adopted = adoptStoredPayload(run.state, "box");
    if (!adopted.ok) throw new Error(adopted.reason);
    expect(adopted.payload.traits.owner).toEqual({ id: "runActive" });
    const removed = removeCardForRun(adopted.state, "inside")!;
    expect(removed.retiredActives?.map(({ id }) => id)).toEqual(["box", "inside"]);
  });

  it("returns an adopted card to the deck at table clear, never the wrapper", () => {
    const run = runWith(devOpaqueContainer("box", king("inside")));
    const adopted = adoptStoredPayload(run.state, "box");
    if (!adopted.ok) throw new Error(adopted.reason);
    const cleared = clearField(adopted.state);
    expect(cleared.deck.map(({ id }) => id)).toContain("inside");
    expect(cleared.deck.map(({ id }) => id)).not.toContain("box");
  });

  it("continues from a save with the adopted card and the retired wrapper accounted for", () => {
    const run = runWith(devOpaqueContainer("box", king("inside")));
    const adopted = adoptStoredPayload(run.state, "box");
    if (!adopted.ok) throw new Error(adopted.reason);
    const after = GameRun.fromSnapshot(
      dealerRegistry,
      sandboxRunRules(demoRunRules),
      standardDeck,
      { ...run.snapshot(), state: adopted.state },
      () => 0,
    );
    const record = JSON.parse(JSON.stringify(toSaveRecord(after.snapshot())));
    const restored = fromSaveRecord(record, standardDeck, dealerRegistry);
    expect(restored).not.toBeNull();
    expect(restored!.state.field[0]!.block.id).toBe("inside");
    expect(restored!.state.field[0]!.block.traits.identity?.suit.name).toBe("hearts");
    expect(restored!.state.retiredActives?.map(({ id }) => id)).toEqual(["box"]);
    expect(restored!.state.removedCards).toEqual(["box"]);
  });

  it("keeps an adopted payload's run ownership through Continue, so removal still saves", () => {
    const rankless = { id: "inside", definition: "devRanklessActive", components: {} };
    const run = runWith(devOpaqueContainer("box", rankless));
    const adopted = adoptStoredPayload(run.state, "box");
    if (!adopted.ok) throw new Error(adopted.reason);
    const rules = sandboxRunRules(demoRunRules);
    const after = GameRun.fromSnapshot(
      dealerRegistry,
      rules,
      standardDeck,
      { ...run.snapshot(), state: adopted.state },
      () => 0,
    );
    const continued = fromSaveRecord(
      JSON.parse(JSON.stringify(toSaveRecord(after.snapshot()))),
      standardDeck,
      dealerRegistry,
    )!;
    const inside = continued.state.field.find(({ block }) => block.id === "inside")!.block;
    expect(inside.traits.owner).toEqual({ id: "runActive" });
    const removed = removeCardForRun(continued.state, "inside")!;
    expect(removed.retiredActives?.map(({ id }) => id)).toEqual(["box", "inside"]);
    const resaved = GameRun.fromSnapshot(
      dealerRegistry,
      rules,
      standardDeck,
      { ...continued, state: removed },
      () => 0,
    );
    expect(
      fromSaveRecord(
        JSON.parse(JSON.stringify(toSaveRecord(resaved.snapshot()))),
        standardDeck,
        dealerRegistry,
      ),
    ).not.toBeNull();
  });
});
