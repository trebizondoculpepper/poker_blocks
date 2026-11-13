import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { dealerRegistry } from "./dealer";
import { devOpaqueContainer } from "./dev-rankless-active";
import { GameRun } from "./game-run";
import type { GameEvent } from "./passives";
import { demoRunRules, sandboxRunRules } from "./run-rules";
import { fromSaveRecord, toSaveRecord } from "./save";
import "./opaque-container";

const kingOfHearts = (id: string) => ({
  id,
  definition: "playableCard",
  components: { pokerIdentity: { rank: "K", suit: "hearts" } },
});

/** A run whose hand is exactly these blocks. */
function runWithHand(hand: CardBlock[]) {
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
        hand,
        // Every standard card not in this hand stays in the deck, so a save accounts for all.
        deck: standardDeck.filter((card) => !hand.some(({ id }) => id === card.id)),
      },
    },
    () => 0,
  );
}

const facts = (run: GameRun) => run.actionFacts.map(({ payload }) => payload as GameEvent);

describe("opening a placed container (#554)", () => {
  it("replaces the wrapper with its payload in the same cell, before scoring", () => {
    const container = devOpaqueContainer("box-1", kingOfHearts("revealed-1"));
    const king = standardDeck[12]!; // K of spades: pairs with the revealed K of hearts.
    const run = runWithHand([king, container]);
    expect(run.play({ cardId: king.id })).not.toBeNull();
    expect(run.play({ cardId: container.id, targetId: king.id, face: "east" })).not.toBeNull();
    const ids = run.state.field.map(({ block }) => block.id);
    expect(ids).toContain("revealed-1");
    expect(ids).not.toContain("box-1");
    const revealed = run.state.field.find(({ block }) => block.id === "revealed-1")!;
    expect(revealed.cell).toEqual({ x: 1, y: 0, z: 0 });
    expect(revealed.block.traits.identity?.rank).toBe("K");
    expect(revealed.block.traits.selectable).toBeUndefined();
    const opened = facts(run).filter(({ type }) => type === "block.opened");
    expect(opened).toEqual([
      expect.objectContaining({ opened: { wrapperId: "box-1", payloadId: "revealed-1" } }),
    ]);
    // The revealed king scored with the placed one: a pair, in this play.
    expect(run.state.round.score).toBeGreaterThan(0);
    expect(run.state.hand.map(({ id }) => id)).not.toContain("box-1");
  });

  it("opens every container a group placement places, in placement order", () => {
    const a = devOpaqueContainer("box-a", kingOfHearts("revealed-a"));
    const b = devOpaqueContainer("box-b", {
      ...kingOfHearts("revealed-b"),
      components: { pokerIdentity: { rank: "Q", suit: "clubs" } },
    });
    const run = runWithHand([a, b]);
    expect(run.play({ cardId: a.id, cardIds: [a.id, b.id] })).not.toBeNull();
    expect(
      facts(run)
        .filter(({ type }) => type === "block.opened")
        .map(({ opened }) => opened!.payloadId),
    ).toEqual(["revealed-a", "revealed-b"]);
  });

  it("refuses an opening whose payload ID is already in play, rolling back", () => {
    const clash = devOpaqueContainer("box-x", kingOfHearts(standardDeck[0]!.id));
    const run = runWithHand([standardDeck[0]!, clash]);
    expect(run.play({ cardId: standardDeck[0]!.id })).not.toBeNull();
    const before = run.state;
    expect(run.play({ cardId: clash.id, targetId: standardDeck[0]!.id, face: "east" })).toBeNull();
    expect(run.state).toBe(before);
  });
});

describe("containers and revealed cards in saves (#554)", () => {
  const roundTrip = (run: GameRun) =>
    fromSaveRecord(
      JSON.parse(JSON.stringify(toSaveRecord(run.snapshot()))),
      standardDeck,
      dealerRegistry,
    );

  it("keeps an unopened container's payload nested and hidden from the zones", () => {
    const run = runWithHand([devOpaqueContainer("box-1", kingOfHearts("revealed-1"))]);
    const record = toSaveRecord(run.snapshot());
    expect(record.state.activeObjects?.["box-1"]?.components.opaqueContainer).toEqual(
      kingOfHearts("revealed-1"),
    );
    expect(record.state.activeObjects).not.toHaveProperty("revealed-1");
    const restored = roundTrip(run)!;
    expect(restored.state.hand[0]!.traits.opaqueContainer?.payload.id).toBe("revealed-1");
  });

  it("continues a revealed card as a run-owned playable card", () => {
    const king = standardDeck[12]!;
    const run = runWithHand([king, devOpaqueContainer("box-1", kingOfHearts("revealed-1"))]);
    run.play({ cardId: king.id });
    run.play({ cardId: "box-1", targetId: king.id, face: "east" });
    const restored = roundTrip(run)!;
    const revealed = restored.state.field.find(({ block }) => block.id === "revealed-1")!;
    expect(revealed.block.traits.identity?.suit.name).toBe("hearts");
  });

  it("rejects a container holding a container, or an unknown payload definition", () => {
    const run = runWithHand([devOpaqueContainer("box-1", kingOfHearts("revealed-1"))]);
    const nested = JSON.parse(JSON.stringify(toSaveRecord(run.snapshot())));
    nested.state.activeObjects["box-1"].components.opaqueContainer.components = {
      opaqueContainer: kingOfHearts("deeper"),
    };
    expect(fromSaveRecord(nested, standardDeck, dealerRegistry)).toBeNull();
    const unknown = JSON.parse(JSON.stringify(toSaveRecord(run.snapshot())));
    unknown.state.activeObjects["box-1"].components.opaqueContainer.definition = "nope";
    expect(fromSaveRecord(unknown, standardDeck, dealerRegistry)).toBeNull();
  });
});
