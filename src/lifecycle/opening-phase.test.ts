import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "../cards";
import { dealerRegistry } from "../dealer";
import { GameRun } from "../game-run";
import { demoRunRules, sandboxRunRules, type RunRules } from "../run-rules";
import { openingHandlers, validatePlayPhases } from "./play-phases";

// Fixture openings (#926): a trait whose handler swaps the placed block for a revealed one in the
// same cell, and one whose handler fails. Real wrappers (#930) register their own.
const revealed = (id: string) => `${id}:revealed`;
if (!openingHandlers.has("testWrapper")) {
  openingHandlers.register("testWrapper", (blockId, _config, target) => {
    const state = target.state;
    target.update({
      ...state,
      field: state.field.map((entry) => {
        if (entry.block.id !== blockId) return entry;
        const traits = { ...entry.block.traits } as Record<string, unknown>;
        delete traits.testWrapper;
        return {
          ...entry,
          block: { ...entry.block, id: revealed(blockId), traits } as CardBlock,
        };
      }),
    });
    return {
      events: [{ type: "block.opened", blockId, cardIds: [blockId, revealed(blockId)] }],
      replacedBy: revealed(blockId),
    };
  });
  openingHandlers.register("testBrokenWrapper", () => {
    throw new Error("broken wrapper");
  });
}
const wrapped = (card: CardBlock, trait = "testWrapper"): CardBlock =>
  ({ ...card, traits: { ...card.traits, [trait]: {} } }) as CardBlock;

function runWith(hand: CardBlock[], rules: RunRules = sandboxRunRules(demoRunRules)) {
  const start = new GameRun(dealerRegistry, rules, standardDeck, () => 0);
  return GameRun.fromSnapshot(
    dealerRegistry,
    rules,
    standardDeck,
    { ...start.snapshot(), state: { ...start.state, hand } },
    () => 0,
  );
}
const facts = (game: GameRun, type: string) =>
  game.actionFacts.filter((fact) => fact.type === type);

describe("the opening phase (#926)", () => {
  it("opens a placed block before the material phases; later phases see the revealed identity", () => {
    const card = wrapped(standardDeck[0]!);
    const game = runWith([card, standardDeck[13]!]);
    expect(game.play({ cardId: card.id })).not.toBeNull();
    expect(facts(game, "play.placed")[0]!.subjectIds).toEqual([card.id]);
    expect(facts(game, "block.opened")[0]!.phase).toBe("opening");
    expect(facts(game, "play.beforeScore")[0]!.subjectIds).toEqual([revealed(card.id)]);
    expect(facts(game, "play.completed")[0]!.subjectIds).toEqual([revealed(card.id)]);
    expect(game.state.field.map(({ block }) => block.id)).toEqual([revealed(card.id)]);
    const phases = [...new Set(game.actionFacts.map(({ phase }) => phase))];
    expect(phases.indexOf("opening")).toBe(phases.indexOf("placement") + 1);
  });

  it("opens a group in placement order, each revealed identity once", () => {
    const [a, b] = [wrapped(standardDeck[0]!), wrapped(standardDeck[1]!)];
    const game = runWith([a, b]);
    expect(game.play({ cardId: a.id, cardIds: [a.id, b.id] })).not.toBeNull();
    expect(facts(game, "block.opened").map(({ subjectIds }) => subjectIds[0])).toEqual([
      a.id,
      b.id,
    ]);
    expect(facts(game, "play.beforeScore")[0]!.subjectIds).toEqual([
      revealed(a.id),
      revealed(b.id),
    ]);
  });

  it("scores the revealed identity, never the wrapper", () => {
    const [a, b] = [wrapped(standardDeck[0]!), wrapped(standardDeck[1]!)];
    const game = runWith([a, b]);
    expect(game.play({ cardId: a.id, cardIds: [a.id, b.id] })).not.toBeNull();
    const scored = game.lastScoredLines.flatMap(({ blockIds }) => blockIds);
    expect(scored).toEqual(expect.arrayContaining([revealed(a.id), revealed(b.id)]));
    expect(scored).not.toContain(a.id);
  });

  it("rolls back an earlier successful opening when a later one fails", () => {
    const [good, broken] = [
      wrapped(standardDeck[0]!),
      wrapped(standardDeck[1]!, "testBrokenWrapper"),
    ];
    const game = runWith([good, broken]);
    const before = game.state;
    const factsBefore = game.actionFacts.length;
    let failed = false;
    try {
      failed = game.play({ cardId: good.id, cardIds: [good.id, broken.id] }) === null;
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(game.state).toEqual(before);
    expect(game.state.hand.map(({ id }) => id)).toEqual([good.id, broken.id]);
    expect(game.actionFacts.length).toBe(factsBefore);
  });

  it("leaves ordinary placements alone", () => {
    const card = standardDeck[0]!;
    const game = runWith([card]);
    expect(game.play({ cardId: card.id })).not.toBeNull();
    expect(facts(game, "block.opened")).toEqual([]);
    expect(facts(game, "play.beforeScore")[0]!.subjectIds).toEqual([card.id]);
  });

  it("opens nothing when no opening controller is composed onto the playfield", () => {
    const card = wrapped(standardDeck[0]!);
    const rules = { ...sandboxRunRules(demoRunRules), playfield: [] };
    const game = runWith([card], rules);
    expect(game.play({ cardId: card.id })).not.toBeNull();
    expect(game.state.field.map(({ block }) => block.id)).toEqual([card.id]);
  });

  it("rolls the whole play back when an opening fails", () => {
    const card = wrapped(standardDeck[0]!, "testBrokenWrapper");
    const game = runWith([card]);
    const before = game.state;
    let failed = false;
    try {
      failed = game.play({ cardId: card.id }) === null;
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(game.state).toEqual(before);
  });

  it("validates opening steps like any other phase's", () => {
    expect(validatePlayPhases({ opening: ["nope"], beforeScore: [], afterScore: [] })).toEqual([
      'unknown play step "nope"',
    ]);
  });
});
