import { describe, expect, it } from "vite-plus/test";
import { ruleHandlers } from "./rule-handlers";
import { commitCommands } from "./rule-commands";
import type { RuleFrame } from "./event-rules";
import type { GameState } from "./game-state";
import { standardDeck, type CardBlock } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { tokenEffects } from "./passive-activation-effects";
import { createPassiveBlock } from "./passives";
import { demoRunRules, sandboxRunRules } from "./run-rules";

const card = (rank: string, suit: string): CardBlock =>
  standardDeck.find(
    (block) => block.traits.identity.rank === rank && block.traits.identity.suit.name === suit,
  )!;

describe("passive activation feedback (#81)", () => {
  it.each(["pulse", "echo"])(
    "%s swells and glows, then rests; reduced motion keeps only the glow",
    (id) => {
      const effect = tokenEffects.get(id);
      expect(effect.frame(0, false)).toEqual({ scale: 1, glow: 0 });
      const peak = effect.frame(0.25, false);
      expect(peak.scale).toBeGreaterThan(1);
      expect(peak.glow).toBeGreaterThan(0);
      const reduced = effect.frame(0.25, true);
      expect(reduced.scale).toBe(1);
      expect(reduced.glow).toBe(peak.glow);
      expect(effect.frame(1, false).glow).toBeCloseTo(0);
    },
  );

  it("reports a discard's coins as an event carrying its sound, not a state difference (#538)", () => {
    const game = new GameRun(dealerRegistry, sandboxRunRules(demoRunRules), standardDeck, () => 0);
    game.installPassive(createPassiveBlock("scrapper", "passive.1"));
    const hand = [card("2", "clubs"), card("3", "hearts")];
    const run = GameRun.fromSnapshot(
      dealerRegistry,
      sandboxRunRules(demoRunRules),
      standardDeck,
      { ...game.snapshot(), state: { ...game.state, hand } },
      () => 0,
    );
    run.discard([hand[0]!.id]);
    expect(run.lastDiscardEvents.filter(({ sound }) => sound)).toEqual([
      { type: "coins.gained", amount: 1, sound: "passive.coins" },
    ]);
  });

  it("carries a rule's configured sound through to the committed coins event (#566 review)", () => {
    const blocks = [card("2", "clubs"), card("3", "hearts")];
    const frame = ruleHandlers.evaluate(
      {
        on: "discard.completed",
        select: { id: "event-blocks", config: { where: { id: "always", config: {} } } },
        where: { id: "always", config: {} },
        effects: [{ id: "add-coins-per-selected", config: { amount: 1, sound: "action.denied" } }],
      },
      { event: { type: "discard.completed", blocks }, commands: [] } as unknown as RuleFrame,
    );
    const events = commitCommands(frame.commands, {
      state: { coins: 0 } as GameState,
      update() {},
      grantUnownedPassive: () => [],
    });
    expect(events).toEqual([{ type: "coins.gained", amount: 2, sound: "action.denied" }]);
  });

  it("a grant the full rack refuses reports nothing, so no grant sound plays (#566 review)", () => {
    const rules = { ...sandboxRunRules(demoRunRules), rackCapacity: 1 };
    const game = new GameRun(dealerRegistry, rules, standardDeck, () => 0);
    game.installPassive(createPassiveBlock("ace-exchange", "passive.1"));
    const hand = [card("A", "clubs"), card("A", "hearts")];
    const run = GameRun.fromSnapshot(
      dealerRegistry,
      rules,
      standardDeck,
      { ...game.snapshot(), state: { ...game.state, hand } },
      () => 0,
    );
    run.discard(hand.map(({ id }) => id));
    expect(run.state.passiveRack).toHaveLength(1);
    expect(run.lastDiscardEvents.filter(({ sound }) => sound)).toEqual([]);
  });

  it("records which passives' rules fired in the last discard, and only that discard", () => {
    const game = new GameRun(dealerRegistry, sandboxRunRules(demoRunRules), standardDeck, () => 0);
    game.installPassive(createPassiveBlock("scrapper", "passive.1"));
    game.installPassive(createPassiveBlock("seeing-red", "passive.2"));
    const hand = [card("2", "clubs"), card("3", "hearts")];
    const run = GameRun.fromSnapshot(
      dealerRegistry,
      sandboxRunRules(demoRunRules),
      standardDeck,
      { ...game.snapshot(), state: { ...game.state, hand } },
      () => 0,
    );
    run.discard([hand[0]!.id]);
    expect(run.lastDiscardActivations.map(({ sourceId }) => sourceId)).toEqual(["passive.1"]);
    run.discard([hand[1]!.id]);
    expect(run.lastDiscardActivations.map(({ sourceId }) => sourceId)).toEqual([
      "passive.1",
      "passive.2",
    ]);
  });
});

describe("committed sounds (#566 review)", () => {
  it("plays each named sound once per discard, in first-named order", async () => {
    const { committedSounds } = await import("./play-presenter");
    expect(
      committedSounds([
        { type: "coins.gained", amount: 1, sound: "passive.coins" },
        { type: "discard.completed" },
        { type: "coins.gained", amount: 1, sound: "passive.coins" },
        { type: "passive.installed", sound: "passive.granted" },
      ]),
    ).toEqual(["passive.coins", "passive.granted"]);
  });
});
