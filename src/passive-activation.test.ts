import { describe, expect, it } from "vite-plus/test";
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
