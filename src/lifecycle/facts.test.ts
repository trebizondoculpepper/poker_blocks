import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "../cards";
import { dealerRegistry } from "../dealer";
import { GameRun } from "../game-run";
import { demoRunRules, sandboxRunRules } from "../run-rules";

const destructibleDeck = standardDeck.map((card) => ({
  ...card,
  traits: { ...card.traits, destructible: { by: ["manual" as const] } },
}));
const session = () =>
  new GameRun(dealerRegistry, sandboxRunRules(demoRunRules), destructibleDeck, () => 0);
const everywhere = (game: GameRun) => [
  ...game.state.hand,
  ...game.state.deck,
  ...game.state.discardPile,
  ...game.state.field.map(({ block }) => block),
];

describe("discard facts (#659)", () => {
  it("reports each card moved, in order, then the once-per-action batch, all correlated", () => {
    const game = session();
    const [a, b] = game.state.hand;
    const score = game.state.round.score;
    const plays = game.state.round.movesLeft;
    expect(game.discard([a!.id, b!.id])).not.toBeNull();
    const facts = game.actionFacts;
    expect(facts.map(({ type, subjectIds }) => `${type} ${subjectIds.join(",")}`)).toEqual([
      `block.discarded ${a!.id}`,
      `block.discarded ${b!.id}`,
      `discard.completed ${a!.id},${b!.id}`,
    ]);
    expect(new Set(facts.map(({ batchId }) => batchId)).size).toBe(1);
    expect(facts[0]!.batchId).not.toBeNull();
    // A discard scores nothing and uses no play.
    expect(game.state.round.score).toBe(score);
    expect(game.state.round.movesLeft).toBe(plays);
  });
});

describe("destruction facts (#659)", () => {
  it("removes the card from the run for good, with correlated destroyed and removed facts", () => {
    const game = session();
    game.play({ cardId: game.state.hand[0]!.id });
    const target = game.state.field[0]!.block;
    expect(game.destroyBlock(target.id, "manual")).not.toBeNull();
    expect(everywhere(game).some(({ id }) => id === target.id)).toBe(false);
    const facts = game.actionFacts;
    expect(facts.map(({ type }) => type)).toEqual(["block.destroyed", "block.removed"]);
    expect(facts[0]!.batchId).toBe(facts[1]!.batchId);
    expect(facts.every(({ subjectIds }) => subjectIds[0] === target.id)).toBe(true);
    expect((facts[1]!.payload as { cause?: string }).cause).toBe("manual");
  });

  it("is distinct from a discard: a discarded card stays in the run, a destroyed one does not", () => {
    const game = session();
    const kept = game.state.hand[0]!;
    game.discard([kept.id]);
    expect(everywhere(game).some(({ id }) => id === kept.id)).toBe(true);
    expect(game.actionFacts.some(({ type }) => type === "block.destroyed")).toBe(false);
  });

  it("refused destruction changes nothing and records nothing", () => {
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0);
    game.play({ cardId: game.state.hand[0]!.id });
    const before = { state: game.state, facts: game.actionFacts };
    expect(game.destroyBlock(game.state.field[0]!.block.id, "manual")).toBeNull();
    expect(game.state).toBe(before.state);
    expect(game.actionFacts).toBe(before.facts);
  });
});
