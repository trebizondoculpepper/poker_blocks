import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { PlacedBlock } from "./game-state";
import { scoreFieldWithPassives } from "./passive-effects";
import { createPassiveBlock } from "./passives";
import { ruleHandlers } from "./rule-handlers";

const card = (rank: string, suit: string): CardBlock =>
  standardDeck.find(
    (block) => block.traits.identity.rank === rank && block.traits.identity.suit.name === suit,
  )!;
const at = (block: CardBlock, x: number, y = 0): PlacedBlock => ({ block, cell: { x, y, z: 0 } });
/** Two scoring lines crossing at the 3 of hearts. */
const field = [
  at(card("2", "hearts"), -1),
  at(card("3", "hearts"), 0),
  at(card("4", "hearts"), 1),
  at(card("5", "clubs"), 0, 1),
];
const passive = (id: string, index = 1) => createPassiveBlock(id, `passive.${index}`);
const outcomesOf = (lines: ReturnType<typeof scoreFieldWithPassives>, sourceId: string) =>
  lines.flatMap(({ activations }) =>
    activations
      .filter((activation) => activation.sourceId === sourceId)
      .flatMap(({ outcomes }) => outcomes),
  );

describe("resolved activation outcomes (#483)", () => {
  it("leaves every score unchanged", () => {
    const rack = [passive("d6", 1), passive("crossroads", 2), passive("double-line", 3)];
    const random = () => 0.5;
    const once = scoreFieldWithPassives(field, rack, undefined, random);
    const twice = scoreFieldWithPassives(field, rack, undefined, random);
    expect(once.map(({ points }) => points)).toEqual(twice.map(({ points }) => points));
  });

  it("reports a die's actual roll, drawn once for the whole play", () => {
    let draws = 0;
    const random = () => (draws++, 0.99);
    const lines = scoreFieldWithPassives(field, [passive("d6")], undefined, random);
    const rolls = outcomesOf(lines, "passive.1");
    expect(rolls.length).toBeGreaterThan(0);
    expect(rolls.every(({ operand }) => operand === 6)).toBe(true);
    expect(draws).toBe(1);
  });

  it("reports Crossroads' effective contribution, not its configured amount", () => {
    const lines = scoreFieldWithPassives(field, [passive("crossroads")]);
    const added = outcomesOf(lines, "passive.1");
    expect(added.length).toBeGreaterThan(0);
    for (const outcome of added) {
      expect(outcome.operation).toBe("add-line-score");
      expect(outcome.after! - outcome.before!).toBe(outcome.operand);
      expect(outcome.unit).toBe("score");
    }
  });

  it("gives repeated activations distinct IDs and an order", () => {
    const lines = scoreFieldWithPassives(field, [
      passive("double-line", 1),
      passive("double-line", 2),
    ]);
    const activations = lines.flatMap(({ activations }) => activations);
    const ids = activations.map(({ activationId }) => activationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const line of lines)
      expect(line.activations.map(({ order }) => order)).toEqual(
        line.activations.map((_, index) => index),
      );
  });

  it("records an explicit outcome for an effect that reports none, without inferring an operand", () => {
    ruleHandlers.registerEffect<unknown, unknown>(
      "test.silent-halve",
      (_config, _selected, frame) => ({
        ...frame,
        workingValue: (frame.workingValue ?? 0) / 2,
      }),
    );
    const frame = ruleHandlers.evaluate(
      {
        on: "score.beforeLineFinalized",
        select: { id: "scored-line", config: {} },
        where: { id: "always", config: {} },
        effects: [{ id: "test.silent-halve", config: {} }],
      },
      { event: { type: "score.beforeLineFinalized" }, workingValue: 10, commands: [] },
    );
    expect(frame.outcomes).toEqual([{ operation: "test.silent-halve", before: 10, after: 5 }]);
  });
});
