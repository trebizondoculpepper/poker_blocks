import { afterEach, describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { RuleCommand } from "./event-rules";
import "./game-run";
import type { GameState } from "./game-state";
import { getMaterialDefinition, withMaterial, type MaterialDefinition } from "./materials";
import { ruleCommands } from "./rule-commands";
import { triggerBlock } from "./triggers";
import type { Cell } from "./traits/attachable";

// No material uses these responses yet: the tests lend wood a response list.
type Lendable = { -readonly [K in keyof MaterialDefinition]: MaterialDefinition[K] };
const wood = getMaterialDefinition("wood") as Lendable;
const lend = (responses: readonly RuleCommand[]) => (wood.triggerable = { responses });
afterEach(() => void delete wood.triggerable);

const woodCard = (index: number) =>
  withMaterial(standardDeck[index]!, getMaterialDefinition("wood"));
const paperCard = (index: number) =>
  withMaterial(standardDeck[index]!, getMaterialDefinition("paper"));
const at = (x: number, y = 0) => ({ x, y, z: 0 }) as Cell;
const state = (...placed: [CardBlock, Cell][]): GameState => ({
  field: placed.map(([block, cell]) => ({ block, cell })),
  hand: [],
  deck: [],
  discardPile: [],
  passiveRack: [],
  coins: 0,
  round: { score: 0, targetScore: 10, movesLeft: 5, discardsLeft: 3 },
});
const ids = (blocks: readonly { block: CardBlock }[]) => blocks.map(({ block }) => block.id);

describe("self-destruct and target triggers (#435)", () => {
  it("are registered wherever the run is loaded", () => {
    expect(ruleCommands.has("self-destruct")).toBe(true);
    expect(ruleCommands.has("trigger-targets")).toBe(true);
  });

  it("self-destructs off the table into the discard pile, announcing its configured sound", () => {
    lend([{ id: "self-destruct", config: { removal: "field", sound: "block.self_destruct" } }]);
    const [a, b] = [woodCard(0), paperCard(1)];
    const { state: after, events } = triggerBlock(state([a, at(0)], [b, at(1)]), {
      blockId: a.id,
      cause: "test",
    });
    expect(ids(after.field)).toEqual([b.id]);
    expect(after.discardPile.map(({ id }) => id)).toEqual([a.id]);
    expect(after.removedCards).toBeUndefined();
    expect(events.at(-1)).toMatchObject({
      type: "block.removed",
      blockId: a.id,
      sound: "block.self_destruct",
      trigger: { source: { block: a, cell: at(0) } },
    });
  });

  it("can instead remove itself from the run for good, through the shared removal service", () => {
    lend([{ id: "self-destruct", config: { removal: "run" } }]);
    const a = woodCard(0);
    const { state: after } = triggerBlock(state([a, at(0)]), { blockId: a.id, cause: "test" });
    expect(after.field).toEqual([]);
    expect(after.discardPile).toEqual([]);
    expect(after.removedCards).toEqual([a.id]);
  });

  it("passes a trigger to face neighbours, each running its own responses once, never looping", () => {
    // A row of three wood blocks and one touching only at a corner. Each passes the trigger on.
    lend([
      {
        id: "trigger-targets",
        config: { select: { id: "face-neighbours", config: {} }, cause: "chain" },
      },
    ]);
    const [a, b, c, corner] = [woodCard(0), woodCard(1), woodCard(2), woodCard(3)];
    const { events } = triggerBlock(state([a, at(0)], [b, at(1)], [c, at(2)], [corner, at(3, 1)]), {
      blockId: a.id,
      cause: "test",
    });
    const triggered = events.filter(({ type }) => type === "block.triggered");
    expect(triggered.map(({ blockId }) => blockId)).toEqual([a.id, b.id, c.id]);
    expect(triggered.at(-1)!.trigger!.path).toEqual([a.id, b.id, c.id]);
  });

  it("finds neighbours from the snapshot even after the source has removed itself", () => {
    lend([
      { id: "self-destruct", config: { removal: "field" } },
      {
        id: "trigger-targets",
        config: { select: { id: "face-neighbours", config: {} }, cause: "blast" },
      },
    ]);
    const [a, b] = [woodCard(0), woodCard(1)];
    const { state: after, events } = triggerBlock(state([a, at(0)], [b, at(1)]), {
      blockId: a.id,
      cause: "test",
    });
    // B was triggered by A's blast and, with the same responses, removed itself too.
    expect(after.field).toEqual([]);
    expect(
      events.filter(({ type }) => type === "block.removed").map(({ blockId }) => blockId),
    ).toEqual([a.id, b.id]);
  });

  it("does nothing to a neighbour that doesn't respond to triggers", () => {
    lend([
      {
        id: "trigger-targets",
        config: { select: { id: "face-neighbours", config: {} }, cause: "x" },
      },
    ]);
    const [a, b] = [woodCard(0), paperCard(1)];
    const before = state([a, at(0)], [b, at(1)]);
    const { state: after, events } = triggerBlock(before, { blockId: a.id, cause: "test" });
    expect(after).toEqual(before);
    expect(events.map(({ type }) => type)).toEqual(["block.triggered"]);
  });

  it("never reaches a block twice by two routes: a square of four runs each once (#488 review)", () => {
    lend([
      { id: "add-coins", config: { amount: 1 } },
      {
        id: "trigger-targets",
        config: { select: { id: "face-neighbours", config: {} }, cause: "chain" },
      },
    ]);
    const [a, b, c, d] = [woodCard(0), woodCard(1), woodCard(2), woodCard(3)];
    const square = state([a, at(0, 0)], [b, at(1, 0)], [c, at(0, 1)], [d, at(1, 1)]);
    const { state: after, events } = triggerBlock(square, { blockId: a.id, cause: "test" });
    expect(after.coins).toBe(4);
    const triggered = events
      .filter(({ type }) => type === "block.triggered")
      .map(({ blockId }) => blockId);
    expect(new Set(triggered).size).toBe(4);
    expect(triggered).toHaveLength(4);
  });
});
