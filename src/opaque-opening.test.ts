import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { dealerRegistry } from "./dealer";
import { devOpaqueContainer } from "./dev-rankless-active";
import { GameRun } from "./game-run";
import type { GameEvent } from "./passives";
import { demoRunRules, sandboxRunRules } from "./run-rules";
import { fromSaveRecord, toSaveRecord } from "./save";

const card = (id: string, rank = "K") => ({
  id,
  definition: "playableCard",
  components: { pokerIdentity: { rank, suit: "hearts" } },
});
const rules = sandboxRunRules(demoRunRules);

/** A run holding these cards in hand, the standard cards in the deck. */
function runWith(hand: CardBlock[], random: () => number = () => 0) {
  const start = new GameRun(dealerRegistry, rules, standardDeck, () => 0);
  return GameRun.fromSnapshot(
    dealerRegistry,
    rules,
    standardDeck,
    { ...start.snapshot(), state: { ...start.state, hand, field: [], deck: standardDeck } },
    random,
  );
}
const fact = (run: GameRun, type: string) =>
  run.actionFacts.filter((recorded) => recorded.type === type);
const ids = (run: GameRun) => [
  ...run.state.field.map(({ block }) => block.id),
  ...run.state.hand.map(({ id }) => id),
  ...run.state.deck.map(({ id }) => id),
  ...run.state.discardPile.map(({ id }) => id),
];

describe("opening an opaque container when it is placed (#930)", () => {
  it("puts its payload in the same cell, run-owned, before any material phase", () => {
    const run = runWith([devOpaqueContainer("box", card("inside"))]);
    expect(run.play({ cardId: "box" })).not.toBeNull();
    expect(run.state.field.map(({ block, cell }) => [block.id, cell])).toEqual([
      ["inside", { x: 0, y: 0, z: 0 }],
    ]);
    expect(ids(run)).not.toContain("box");
    expect(run.state.retiredActives?.map(({ id }) => id)).toEqual(["box"]);
    expect(run.state.field[0]!.block.traits.owner).toEqual({ id: "runActive" });
    const [opened] = fact(run, "block.opened");
    expect(opened!.phase).toBe("opening");
    expect(fact(run, "play.beforeScore")[0]!.subjectIds).toEqual(["inside"]);
    expect(fact(run, "play.completed")[0]!.subjectIds).toEqual(["inside"]);
  });

  it("reports one deeply captured opening fact with its sound", () => {
    const run = runWith([devOpaqueContainer("box", card("inside"))]);
    run.play({ cardId: "box" });
    const opened = fact(run, "block.opened");
    expect(opened).toHaveLength(1);
    const payload = opened[0]!.payload as GameEvent;
    expect(payload.cardIds).toEqual(["box", "inside"]);
    expect(payload.sound).toBe("block.open");
    expect(payload.blocks!.map(({ id }) => id)).toEqual(["box", "inside"]);
    expect(Object.isFrozen(payload.blocks![1]!.traits)).toBe(true);
  });

  it("opens every container of a group in placement order, and scores the revealed cards", () => {
    const run = runWith([
      devOpaqueContainer("first", card("a", "K")),
      devOpaqueContainer("second", card("b", "K")),
    ]);
    expect(run.play({ cardId: "first", cardIds: ["first", "second"] })).not.toBeNull();
    expect(fact(run, "block.opened").map(({ subjectIds }) => subjectIds[0])).toEqual([
      "first",
      "second",
    ]);
    const scored = run.lastScoredLines.flatMap(({ blockIds }) => blockIds);
    expect(scored).toEqual(expect.arrayContaining(["a", "b"]));
    expect(scored).not.toContain("first");
  });

  it("draws no randomness to open", () => {
    let draws = 0;
    const counting = () => (draws++, 0);
    const plain = runWith([standardDeck[0]!], counting);
    plain.play({ cardId: standardDeck[0]!.id });
    const plainDraws = draws;
    draws = 0;
    const boxed = runWith([devOpaqueContainer("box", card("inside"))], counting);
    boxed.play({ cardId: "box" });
    expect(draws).toBe(plainDraws);
  });

  it("refuses a payload whose identity is already in play, rolling the whole play back", () => {
    const run = runWith([devOpaqueContainer("box", card(standardDeck[5]!.id))]);
    const before = run.state;
    let failed = false;
    try {
      failed = run.play({ cardId: "box" }) === null;
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(run.state).toEqual(before);
  });

  it("saves the revealed card and Continue restores it without opening again", () => {
    const run = runWith([devOpaqueContainer("box", card("inside"))]);
    run.play({ cardId: "box" });
    const restored = fromSaveRecord(toSaveRecord(run.snapshot()), standardDeck, dealerRegistry)!;
    expect(restored).not.toBeNull();
    const resumed = GameRun.fromSnapshot(dealerRegistry, rules, standardDeck, restored, () => 0);
    expect(resumed.state.field.map(({ block }) => block.id)).toEqual(["inside"]);
    expect(ids(resumed)).not.toContain("box");
    expect(resumed.actionFacts.filter(({ type }) => type === "block.opened")).toEqual([]);
  });
});
