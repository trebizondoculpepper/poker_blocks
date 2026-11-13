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

  it("captures each source's description as it was when the rule fired (#858 review)", () => {
    const rack = [passive("double-line")];
    const lines = scoreFieldWithPassives(field, rack);
    const activation = lines[0]!.activations.find(({ sourceId }) => sourceId === "passive.1")!;
    expect(activation.sourceDescription).toBe(rack[0]!.traits.inspectable.inspect());
  });

  it("numbers a play's activations under its action, so a re-scored line gets new IDs", async () => {
    const { GameRun } = await import("./game-run");
    const { dealerRegistry } = await import("./dealer");
    const { sandboxRunRules, demoRunRules } = await import("./run-rules");
    const run = new GameRun(dealerRegistry, sandboxRunRules(demoRunRules), standardDeck, () => 0);
    run.installPassive(passive("double-line"));
    run.play({ cardId: run.state.hand[0]!.id });
    const first = run.lastScoredLines.flatMap(({ activations }) =>
      activations.map(({ activationId }) => activationId),
    );
    const placed = run.state.field[0]!.block.id;
    run.play({ cardId: run.state.hand[0]!.id, targetId: placed, face: "east" });
    const second = run.lastScoredLines.flatMap(({ activations }) =>
      activations.map(({ activationId }) => activationId),
    );
    for (const id of second) expect(first).not.toContain(id);
  });
});

describe("committed command outcomes (#858 review)", () => {
  it("records what a command actually did, and an explicit nothing when it did nothing", async () => {
    const { commitCommandsWithOutcomes } = await import("./rule-commands");
    const target = (granted: boolean) => {
      let state = { coins: 0 } as never;
      return {
        get state() {
          return state;
        },
        update: (next: never) => void (state = next),
        grantUnownedPassive: () => (granted ? [{ type: "passive.installed", blockId: "p9" }] : []),
      };
    };
    const grant = [{ id: "grant-unowned-passive", config: {} }];
    expect(commitCommandsWithOutcomes(grant, target(true) as never).outcomes).toEqual([
      {
        operation: "grant-unowned-passive.committed",
        operand: 1,
        unit: "facts",
        targets: ["passive.installed:p9"],
      },
    ]);
    // A full rack: the grant is refused, recorded as an explicit no-op.
    expect(commitCommandsWithOutcomes(grant, target(false) as never).outcomes).toEqual([
      { operation: "grant-unowned-passive.committed", operand: 0, unit: "facts", targets: [] },
    ]);
  });
});
