import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { RuleCommand } from "./event-rules";
import type { GameState } from "./game-state";
import { getMaterialDefinition, withMaterial } from "./materials";
import { registerRuleCommand } from "./rule-commands";
import { commitTrigger, inheritedTrigger, triggerBlock, type TriggerContext } from "./triggers";
import { ruleCommands } from "./rule-commands";
import type { Cell } from "./traits/attachable";

// Test-only responses: record what each saw, remove the source, or trigger another block.
const seen: { label: string; trigger: TriggerContext; present: boolean }[] = [];
registerRuleCommand<{ label: string; trigger: TriggerContext }>("test-record", (config, target) => {
  seen.push({
    label: config.label,
    trigger: config.trigger,
    present: target.state.field.some(({ block }) => block.id === config.trigger.source.block.id),
  });
  return [];
});
registerRuleCommand<{ trigger: TriggerContext }>("test-remove-self", ({ trigger }, target) => {
  target.update({
    ...target.state,
    field: target.state.field.filter(({ block }) => block.id !== trigger.source.block.id),
  });
  return [{ type: "test.removed", blockId: trigger.source.block.id }];
});
const responses = new Map<string, readonly RuleCommand[]>();
registerRuleCommand<{ next: string; trigger: TriggerContext }>("test-trigger", (config, target) =>
  commitTrigger(
    { blockId: config.next, cause: "test", path: config.trigger.path },
    target,
    (block) => responses.get(block.id) ?? [],
  ),
);

const card = (index: number): CardBlock =>
  withMaterial(standardDeck[index]!, getMaterialDefinition("wood"));
const [a, b, c] = [card(0), card(1), card(2)];
const at = (x: number) => ({ x, y: 0, z: 0 }) as Cell;
const state = (): GameState => ({
  field: [
    { block: a, cell: at(0) },
    { block: b, cell: at(1) },
    { block: c, cell: at(2) },
  ],
  hand: [],
  deck: [],
  discardPile: [],
  passiveRack: [],
  coins: 0,
  round: { score: 0, targetScore: 10, movesLeft: 5, discardsLeft: 3 },
});
const run = (blockId: string, current = state()) =>
  triggerBlock(current, { blockId, cause: "test" }, (block) => responses.get(block.id) ?? []);

describe("triggerable blocks (#433)", () => {
  it("runs a block's responses in order, after announcing the trigger, with its context", () => {
    seen.length = 0;
    responses.set(a.id, [
      { id: "test-record", config: { label: "first" } },
      { id: "test-record", config: { label: "second" } },
    ]);
    const { events } = run(a.id);
    expect(events[0]).toMatchObject({ type: "block.triggered", blockId: a.id });
    expect(seen.map(({ label }) => label)).toEqual(["first", "second"]);
    expect(seen[0]!.trigger).toEqual({
      cause: "test",
      source: { block: a, cell: at(0) },
      path: [a.id],
      visited: new Set([a.id]),
    });
  });

  it("captures the block before removal: later responses still know what and where it was", () => {
    seen.length = 0;
    responses.set(a.id, [
      { id: "test-remove-self", config: {} },
      { id: "test-record", config: { label: "after" } },
    ]);
    const { state: after, events } = run(a.id);
    expect(after.field.map(({ block }) => block.id)).toEqual([b.id, c.id]);
    expect(seen[0]).toMatchObject({
      present: false,
      trigger: { source: { block: a, cell: at(0) } },
    });
    expect(events.map(({ type }) => type)).toEqual(["block.triggered", "test.removed"]);
  });

  it("does nothing for a block that has left play, or one with no responses", () => {
    responses.set(a.id, [{ id: "test-record", config: { label: "x" } }]);
    const gone = { ...state(), field: state().field.slice(1) };
    expect(run(a.id, gone)).toEqual({ state: gone, events: [] });
    responses.delete(b.id);
    const before = state();
    expect(run(b.id, before)).toEqual({ state: before, events: [] });
  });

  it("propagates depth-first through the same command, never looping within a chain", () => {
    seen.length = 0;
    responses.set(a.id, [
      { id: "test-record", config: { label: "a" } },
      { id: "test-trigger", config: { next: b.id } },
    ]);
    responses.set(b.id, [
      { id: "test-record", config: { label: "b" } },
      { id: "test-trigger", config: { next: a.id } },
      { id: "test-trigger", config: { next: c.id } },
    ]);
    responses.set(c.id, [{ id: "test-record", config: { label: "c" } }]);
    const { events } = run(a.id);
    expect(seen.map(({ label }) => label)).toEqual(["a", "b", "c"]);
    expect(seen.at(-1)!.trigger.path).toEqual([a.id, b.id, c.id]);
    expect(
      events.filter(({ type }) => type === "block.triggered").map(({ blockId }) => blockId),
    ).toEqual([a.id, b.id, c.id]);
  });

  it("lets a separate, later trigger set the same block off again", () => {
    seen.length = 0;
    responses.set(c.id, [{ id: "test-record", config: { label: "c" } }]);
    const once = run(c.id);
    run(c.id, once.state);
    expect(seen.map(({ label }) => label)).toEqual(["c", "c"]);
  });

  it("reads a real block's responses from its material, so a saved card keeps them", () => {
    // No material responds to triggers yet: an ordinary card ignores the registered command.
    const before = state();
    expect(triggerBlock(before, { blockId: a.id, cause: "test" })).toEqual({
      state: before,
      events: [],
    });
  });

  it("carries the chain through the registered command, so a self-trigger can't loop (#475 review)", () => {
    const source = { block: a, cell: at(0) };
    const parent: TriggerContext = {
      cause: "test",
      source,
      path: [a.id],
      visited: new Set([a.id]),
    };
    expect(inheritedTrigger({ blockId: a.id, cause: "again", trigger: parent })).toEqual({
      blockId: a.id,
      cause: "again",
      path: [a.id],
      visited: parent.visited,
    });
    // A response on A that triggers A again, through the registered command: A is in its own
    // chain, so the nested trigger does nothing and returns.
    let current = state();
    const target = {
      get state() {
        return current;
      },
      update: (next: GameState) => void (current = next),
      grantUnownedPassive: () => [],
    };
    const events = ruleCommands.get("trigger-block")(
      { blockId: a.id, cause: "again", trigger: parent },
      target,
    );
    expect(events).toEqual([]);
  });
});
