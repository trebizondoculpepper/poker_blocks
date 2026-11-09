import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import type { PlacedBlock } from "./game-state";
import { scoreFieldWithPassives } from "./passive-effects";
import { createPassiveBlock, randomPassiveDefinitions } from "./passives";
import { demoRunRules, sandboxRunRules } from "./run-rules";

const card = (rank: string, suit: string): CardBlock =>
  standardDeck.find(
    (block) => block.traits.identity.rank === rank && block.traits.identity.suit.name === suit,
  )!;
const placed = (block: CardBlock, x: number, y = 0): PlacedBlock => ({
  block,
  cell: { x, y, z: 0 },
});
const passive = (name: string, index: number) => createPassiveBlock(name, `passive.${index}`);

describe("configured passive effects", () => {
  it("uses material value rules before hand multipliers and line rules in rack order", () => {
    const wood = {
      ...card("7", "hearts"),
      traits: { ...card("7", "hearts").traits, material: { kind: "wood" as const } },
    };
    const meat = {
      ...card("7", "clubs"),
      traits: { ...card("7", "clubs").traits, material: { kind: "meat" as const } },
    };
    const field = [placed(wood, 0), placed(meat, 1)];
    const rack = [passive("woodworker", 1), passive("carnivore", 2), passive("double-line", 3)];
    expect(scoreFieldWithPassives(field, rack)[0].points).toBe((7 + 3 + 7 * 2) * 2 * 2);
    expect(
      scoreFieldWithPassives(field, [passive("long-haul", 4), passive("double-line", 5)])[0].points,
    ).toBe((28 - 5) * 2);
    expect(
      scoreFieldWithPassives(field, [passive("double-line", 5), passive("long-haul", 4)])[0].points,
    ).toBe(28 * 2 - 5);
  });

  it("counts each perpendicular intersection once per line", () => {
    const field = [
      placed(card("2", "hearts"), -1),
      placed(card("3", "hearts"), 0),
      placed(card("4", "hearts"), 1),
      placed(card("5", "clubs"), 0, 1),
    ];
    const base = scoreFieldWithPassives(field, []);
    const boosted = scoreFieldWithPassives(field, [passive("crossroads", 1)]);
    expect(boosted.map(({ points }, index) => points - base[index].points)).toEqual([3, 3]);
  });

  it("awards discard coins and grants one unowned passive for two Aces", () => {
    const game = new GameRun(dealerRegistry, sandboxRunRules(demoRunRules), standardDeck, () => 0);
    game.installPassive(passive("scrapper", 1));
    game.installPassive(passive("seeing-red", 2));
    game.installPassive(passive("ace-exchange", 3));
    const state = game.state;
    const aces = [card("A", "hearts"), card("A", "spades")];
    const resumed = GameRun.fromSnapshot(
      dealerRegistry,
      sandboxRunRules(demoRunRules),
      standardDeck,
      { ...game.snapshot(), state: { ...state, hand: aces } },
      () => 0,
    );
    resumed.discard(aces.map(({ id }) => id));
    expect(resumed.state.coins).toBe(3);
    expect(resumed.state.passiveRack).toHaveLength(4);
    expect(new Set(resumed.state.passiveRack.map(({ definitionId }) => definitionId)).size).toBe(4);
  });

  it("draws distinct starting definitions", () => {
    const picked = randomPassiveDefinitions(2, () => 0);
    expect(picked).toHaveLength(2);
    expect(picked[0].id).not.toBe(picked[1].id);
    expect(picked.every(({ id }) => id !== "do-nothing")).toBe(true);
    expect(randomPassiveDefinitions(20, () => 0).map(({ id }) => id)).not.toContain("do-nothing");
  });

  it("replaces a retired passive from an older save with two active blocks", () => {
    const game = new GameRun(dealerRegistry, sandboxRunRules(demoRunRules), standardDeck, () => 0);
    const original = passive("do-nothing", 1);
    game.installPassive(original);
    const restored = GameRun.fromSnapshot(
      dealerRegistry,
      sandboxRunRules(demoRunRules),
      standardDeck,
      game.snapshot(),
      () => 0,
    );
    restored.fillPassiveRack(2);
    restored.fillPassiveRack(2);
    expect(restored.state.passiveRack).toHaveLength(2);
    expect(restored.state.passiveRack.map(({ definitionId }) => definitionId)).toEqual([
      "double-line",
      "quad-line",
    ]);
    expect(restored.state.hand).toEqual(game.state.hand);
  });

  it("uses the same modified lines for the stage total and presentation", () => {
    const game = new GameRun(dealerRegistry, sandboxRunRules(demoRunRules), standardDeck, () => 0);
    game.installPassive(passive("double-line", 1));
    const state = game.state;
    const first = card("7", "hearts");
    const second = card("7", "clubs");
    const resumed = GameRun.fromSnapshot(
      dealerRegistry,
      sandboxRunRules(demoRunRules),
      standardDeck,
      { ...game.snapshot(), state: { ...state, field: [placed(first, 0)], hand: [second] } },
      () => 0,
    );
    resumed.play({ cardId: second.id, targetId: first.id, face: "east" });
    expect(resumed.lastScoredLines.map(({ points }) => points)).toEqual([56]);
    expect(resumed.state.round.score).toBe(56);
  });
});
