import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { materialOf } from "./materials";
import { demoRunRules } from "./run-rules";
import { fromSaveRecord, toSaveRecord } from "./save";
import { rematerial } from "./card-material";

const session = () => {
  const run = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0);
  run.play({ cardId: run.state.hand[0]!.id });
  run.refillHand();
  return run;
};

const everyCard = (run: GameRun) => [
  ...run.state.hand,
  ...run.state.field.map(({ block }) => block),
  ...run.state.deck,
  ...run.state.discardPile,
];
const find = (run: GameRun, id: string) => everyCard(run).find((card) => card.id === id)!;

describe("permanent per-card material change (#387)", () => {
  it("changes only the material: id, rank and suit stay", () => {
    const run = session();
    const card = run.state.hand[0]!;
    expect(run.changeCardMaterial(card.id, "steel")).not.toBeNull();
    const changed = find(run, card.id);
    expect(materialOf(changed)).toBe("steel");
    expect(changed.traits.identity!).toEqual(card.traits.identity!);
    expect(everyCard(run).filter(({ id }) => id === card.id)).toHaveLength(1);
  });

  it("changes a card wherever it is: on the field and in the deck", () => {
    const run = session();
    const placed = run.state.field[0]!.block;
    const waiting = run.state.deck[0]!;
    run.changeCardMaterial(placed.id, "wood");
    run.changeCardMaterial(waiting.id, "gold");
    expect(materialOf(run.state.field[0]!.block)).toBe("wood");
    expect(materialOf(find(run, waiting.id))).toBe("gold");
  });

  it("refuses the material the card already has, and an unknown card, changing nothing", () => {
    const run = session();
    const card = run.state.hand[0]!;
    const before = run.state;
    expect(run.changeCardMaterial(card.id, materialOf(card))).toBeNull();
    expect(run.changeCardMaterial("no-such-card", "steel")).toBeNull();
    expect(run.state).toBe(before);
  });

  it("drops the traits the old material brought", () => {
    const card = rematerial(standardDeck[0]!, "prismatic");
    expect(card.traits.transparent).toBeDefined();
    const opaque = rematerial(card, "wood");
    expect(opaque.traits.transparent).toBeUndefined();
    expect(materialOf(opaque)).toBe("wood");
  });

  it("survives save and Continue, and older saves without the ledger stay readable", () => {
    const run = session();
    const card = run.state.hand[1]!;
    run.changeCardMaterial(card.id, "terracotta");
    const record = JSON.parse(JSON.stringify(toSaveRecord(run.snapshot())));
    expect(record.state.cardStates).toEqual({ [card.id]: { material: "terracotta" } });
    const restored = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    // Rebuilt cards carry fresh trait functions, so compare what a card is, not object identity.
    const summary = (cards: ReturnType<typeof everyCard>) =>
      cards.map(({ id, traits }) => [id, traits.identity!.rank, materialOf({ id, traits })]);
    expect(restored.state.cardStates).toEqual(run.state.cardStates);
    const resumed = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, restored);
    expect(materialOf(find(resumed, card.id))).toBe("terracotta");
    expect(summary(everyCard(resumed))).toEqual(summary(everyCard(run)));

    const older = structuredClone(record);
    delete older.state.cardStates;
    expect(fromSaveRecord(older, standardDeck, dealerRegistry)).not.toBeNull();
  });

  it("rejects a saved change naming an unknown material or card", () => {
    const run = session();
    const card = run.state.hand[0]!;
    run.changeCardMaterial(card.id, "steel");
    const record = JSON.parse(JSON.stringify(toSaveRecord(run.snapshot())));
    const badMaterial = structuredClone(record);
    badMaterial.state.cardStates[card.id].material = "unobtainium";
    expect(fromSaveRecord(badMaterial, standardDeck, dealerRegistry)).toBeNull();
    const badCard = structuredClone(record);
    badCard.state.cardStates["no-such-card"] = { material: "wood" };
    expect(fromSaveRecord(badCard, standardDeck, dealerRegistry)).toBeNull();
  });
});
