import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { passiveActivations } from "./passive-effects";
import { createPassiveBlock, type PassiveBlock } from "./passives";
import { registerRuleCommand } from "./rule-commands";
import { ruleHandlers } from "./rule-handlers";
import { demoRunRules, sandboxRunRules } from "./run-rules";

const card = (rank: string, suit: string): CardBlock =>
  standardDeck.find(
    (block) => block.traits.identity!.rank === rank && block.traits.identity!.suit.name === suit,
  )!;
const passive = (name: string, index: number) => createPassiveBlock(name, `passive.${index}`);

/** A run holding `rack`, with `hand` in hand, ready to discard. */
function runWith(rack: readonly PassiveBlock[], hand: readonly CardBlock[]): GameRun {
  const game = new GameRun(dealerRegistry, sandboxRunRules(demoRunRules), standardDeck, () => 0);
  for (const block of rack) game.installPassive(block);
  return GameRun.fromSnapshot(
    dealerRegistry,
    sandboxRunRules(demoRunRules),
    standardDeck,
    { ...game.snapshot(), state: { ...game.state, hand: [...hand] } },
    () => 0,
  );
}

describe("discard and stage-won passives run as event rules and commands (#170)", () => {
  it("commits a test-only command from a test-only effect, in rack order, with no discard change", () => {
    registerRuleCommand<Record<never, never>>("test-double-coins", (_config, target) => {
      target.update({ ...target.state, coins: target.state.coins * 2 });
      return [];
    });
    ruleHandlers.registerEffect("test-double-coins", (_config, _selected, frame) => ({
      ...frame,
      commands: [...frame.commands, { id: "test-double-coins", config: {} }],
    }));
    const doubler: PassiveBlock = {
      ...passive("scrapper", 2),
      definitionId: "test-doubler",
      traits: {
        ...passive("scrapper", 2).traits,
        passive: {
          traitId: "passive.event-rules",
          eventRules: [
            {
              on: "discard.completed",
              select: { id: "event-blocks", config: { where: { id: "always", config: {} } } },
              where: { id: "always", config: {} },
              effects: [{ id: "test-double-coins", config: {} }],
            },
          ],
        },
      },
    };
    const hand = [card("2", "clubs"), card("3", "clubs")];
    // Scrapper pays 2, then the doubler (to its right) doubles the balance.
    const scrapperFirst = runWith([passive("scrapper", 1), doubler], hand);
    scrapperFirst.discard(hand.map(({ id }) => id));
    expect(scrapperFirst.state.coins).toBe(4);
    // The other way round, the doubler doubles nothing first.
    const doublerFirst = runWith([doubler, passive("scrapper", 1)], hand);
    doublerFirst.discard(hand.map(({ id }) => id));
    expect(doublerFirst.state.coins).toBe(2);
  });

  it("reports which rules fired, with their commands, and nothing when none match", () => {
    const discarded = [card("A", "hearts"), card("A", "spades"), card("5", "diamonds")];
    const event = { type: "discard.completed", blocks: discarded };
    expect(passiveActivations(passive("seeing-red", 1), event)).toEqual([
      {
        sourceId: "passive.1",
        sourceDescription: passive("seeing-red", 1).traits.inspectable.inspect(),
        on: "discard.completed",
        blockId: undefined,
        commands: [{ id: "add-coins", config: { amount: 2 } }],
        // What it did, resolved as it applied (#483): two red cards at 1 coin each.
        outcomes: [{ operation: "add-coins-per-selected", operand: 2, unit: "coins" }],
      },
    ]);
    expect(passiveActivations(passive("ace-exchange", 2), event)[0]!.commands).toEqual([
      { id: "grant-unowned-passive", config: {} },
    ]);
    expect(
      passiveActivations(passive("ace-exchange", 2), { ...event, blocks: discarded.slice(1) }),
    ).toEqual([]);
  });

  it("keeps every passive's rules serializable data with registered handlers", () => {
    for (const name of ["gold-standard", "scrapper", "seeing-red", "ace-exchange"]) {
      const rules = passive(name, 1).traits.passive.eventRules ?? [];
      expect(rules.length, name).toBeGreaterThan(0);
      expect(JSON.parse(JSON.stringify(rules)), name).toEqual(rules);
    }
  });
});
