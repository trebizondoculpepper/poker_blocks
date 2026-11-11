import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import type { GameState } from "./game-state";
import { getMaterialDefinition, withMaterial, type MaterialDefinition } from "./materials";
import { registerRuleCommand, type CommandTarget } from "./rule-commands";
import { demoRunRules } from "./run-rules";
import { fromSaveRecord, toSaveRecord } from "./save";
import { resetStageState } from "./stage-end";
import { commitCountdowns, countdownOf } from "./trigger-countdown";
import type { Cell } from "./traits/attachable";

// No material counts down yet: these tests lend wood a countdown and a recording response.
const fired: string[] = [];
registerRuleCommand<{ trigger: { source: { block: CardBlock } } }>(
  "test-countdown-fired",
  ({ trigger }) => {
    fired.push(trigger.source.block.id);
    return [];
  },
);
type Lendable = { -readonly [K in keyof MaterialDefinition]: MaterialDefinition[K] };
const wood = getMaterialDefinition("wood") as Lendable;
const lend = (countPlacement: boolean) => {
  wood.triggerCountdown = { start: 3, countPlacement };
  wood.triggerable = { responses: [{ id: "test-countdown-fired", config: {} }] };
};
beforeEach(() => {
  fired.length = 0;
  lend(true);
});
afterEach(() => {
  delete wood.triggerCountdown;
  delete wood.triggerable;
});

const woodCard = (index: number) =>
  withMaterial(standardDeck[index]!, getMaterialDefinition("wood"));
const paperCard = (index: number) =>
  withMaterial(standardDeck[index]!, getMaterialDefinition("paper"));
const at = (x: number) => ({ x, y: 0, z: 0 }) as Cell;
function table(...blocks: CardBlock[]) {
  let current: GameState = {
    field: blocks.map((block, x) => ({ block, cell: at(x) })),
    hand: [],
    deck: [],
    discardPile: [],
    passiveRack: [],
    coins: 0,
    round: { score: 0, targetScore: 10, movesLeft: 5, discardsLeft: 3 },
  };
  const target: CommandTarget = {
    get state() {
      return current;
    },
    update: (next) => void (current = next),
    grantUnownedPassive: () => [],
  };
  return { target, block: (i: number) => current.field[i]!.block };
}

describe("trigger countdowns (#434)", () => {
  it("counts 3 in the hand, 2 once placed, 1, then 0 and triggers, with placement counting", () => {
    const bomb = woodCard(0);
    expect(countdownOf(bomb)).toBe(3);
    const { target, block } = table(bomb);
    commitCountdowns(target, new Set([bomb.id]));
    expect(countdownOf(block(0))).toBe(2);
    commitCountdowns(target, new Set(["another"]));
    expect(countdownOf(block(0))).toBe(1);
    expect(fired).toEqual([]);
    const events = commitCountdowns(target, new Set(["another"]));
    expect(countdownOf(block(0))).toBe(0);
    expect(fired).toEqual([bomb.id]);
    expect(events[0]).toMatchObject({ type: "block.triggered", blockId: bomb.id });
  });

  it("never triggers twice: zero stays zero", () => {
    const { target, block } = table(woodCard(0));
    for (let play = 0; play < 6; play++) commitCountdowns(target, new Set());
    expect(countdownOf(block(0))).toBe(0);
    expect(fired).toHaveLength(1);
  });

  it("skips the placing play when the placement doesn't count", () => {
    lend(false);
    const bomb = woodCard(0);
    const { target, block } = table(bomb);
    commitCountdowns(target, new Set([bomb.id]));
    expect(countdownOf(block(0))).toBe(3);
    commitCountdowns(target, new Set());
    expect(countdownOf(block(0))).toBe(2);
  });

  it("leaves blocks that don't count down alone", () => {
    const { target, block } = table(paperCard(1));
    expect(commitCountdowns(target, new Set())).toEqual([]);
    expect(countdownOf(block(0))).toBeNull();
  });

  it("counts on a real committed play, and keeps the count through save and Continue", () => {
    const run = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
    const bomb = run.state.hand[0]!;
    run.changeCardMaterial(bomb.id, "wood");
    run.play({ cardId: bomb.id });
    const placed = run.state.field.find(({ block }) => block.id === bomb.id)!.block;
    expect(countdownOf(placed)).toBe(2);
    expect(run.state.cardStates?.[bomb.id]?.countdown).toBe(2);
    const record = JSON.parse(JSON.stringify(toSaveRecord(run.snapshot())));
    const restored = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    const back = restored.state.field.find(({ block }) => block.id === bomb.id)!.block;
    expect(countdownOf(back)).toBe(2);
    const bad = structuredClone(record);
    bad.state.cardStates[bomb.id].countdown = -1;
    expect(fromSaveRecord(bad, standardDeck, dealerRegistry)).toBeNull();
  });

  it("goes back to its start when the table clears at a stage's end", () => {
    const { target } = table(woodCard(0));
    commitCountdowns(target, new Set());
    const reset = resetStageState(target.state);
    expect(countdownOf(reset.field[0]!.block)).toBe(3);
    expect(reset.cardStates).toBeUndefined();
  });
});
