import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { Registry } from "./core/registry";
import { baseDealer, type Dealer } from "./dealer";
import { GameRun } from "./game-run";
import { demoRunRules, type RunRules } from "./run-rules";
import { createPassiveBlock, passiveDefinitions } from "./passives";
import { materialOf } from "./materials";
import { fromSaveRecord, toSaveRecord } from "./save";
import { couldItBeMagicNow, magicEvery } from "./could-it-be-magic";
import "./trial-modifiers";

const dealers = new Registry<Dealer>("dealer");
dealers.register(baseDealer.name, baseDealer);
const rules: RunRules = {
  stage: () => ({ dealer: "base", targetScore: 1_000_000, plays: 40, discards: 2 }),
  handAtStageEnd: "return-to-deck",
  discardPileAfterShop: "keep-out",
  playfield: demoRunRules.playfield,
};

function session(copies = 1, random: () => number = () => 0) {
  const run = new GameRun(dealers, rules, standardDeck, random);
  for (let copy = 1; copy <= copies; copy++)
    run.installPassive(createPassiveBlock(couldItBeMagicNow.id, `passive.${copy}`));
  return run;
}
const counters = (run: GameRun) =>
  run.state.passiveRack.map(({ traits }) => traits.playCounter?.count);
const magicOnField = (run: GameRun) =>
  run.state.field.filter(({ block }) => materialOf(block) === "magic").map(({ block }) => block.id);
const playOne = (run: GameRun) => {
  const last = run.state.field.at(-1)?.block.id;
  const cardId = run.state.hand[0]!.id;
  const result = run.play(last ? { cardId, targetId: last, face: "east" } : { cardId });
  run.refillHand();
  return result;
};

describe("Could It Be Magic Now? (#988)", () => {
  it("counts each committed play once, and every fourth turns one field card Magic", () => {
    const run = session();
    for (let play = 1; play < magicEvery; play++) {
      expect(playOne(run)).not.toBeNull();
      expect(counters(run)).toEqual([play]);
      expect(magicOnField(run)).toEqual([]);
    }
    playOne(run);
    expect(counters(run)).toEqual([0]);
    expect(magicOnField(run)).toHaveLength(1);
    // The presenter redraws it like any material change (play-presenter reads lastReactions).
    expect(run.lastReactions.map(({ blockId }) => blockId)).toEqual(magicOnField(run));
  });

  it("counts a multi-card play once", () => {
    const run = session();
    const [first, second] = run.state.hand;
    expect(run.play({ cardId: first!.id, cardIds: [first!.id, second!.id] })).not.toBeNull();
    expect(counters(run)).toEqual([1]);
  });

  it("does not count a rejected play or a discard", () => {
    const run = session();
    expect(run.play({ cardId: "no-such-card" })).toBeNull();
    run.discard(run.state.hand[0]!.id);
    expect(counters(run)).toEqual([0]);
  });

  it("gives each copy its own counter; the second never picks the first's target", () => {
    const run = session(2);
    for (let play = 0; play < magicEvery; play++) playOne(run);
    expect(counters(run)).toEqual([0, 0]);
    // Two copies, left to right, each against the field the previous one left: two cards.
    expect(magicOnField(run)).toHaveLength(2);
  });

  it("resets with no eligible target and banks nothing", () => {
    const run = session();
    for (let play = 1; play < magicEvery; play++) playOne(run);
    // Every field card already Magic: nothing is eligible on the fourth play.
    for (const { block } of run.state.field) run.changeCardMaterial(block.id, "magic");
    const card = run.state.hand[0]!;
    run.changeCardMaterial(card.id, "magic");
    const before = run.state.field.length;
    const last = run.state.field.at(-1)!.block.id;
    expect(run.play({ cardId: card.id, targetId: last, face: "east" })).not.toBeNull();
    expect(counters(run)).toEqual([0]);
    expect(run.state.field).toHaveLength(before + 1);
    expect(magicOnField(run)).toHaveLength(before + 1);
  });

  it("chooses its target from the seeded stream, deterministically", () => {
    const pick = (random: () => number) => {
      const run = session(1, random);
      for (let play = 0; play < magicEvery; play++) playOne(run);
      return magicOnField(run);
    };
    expect(pick(() => 0.99)).toEqual(pick(() => 0.99));
    expect(pick(() => 0)).not.toEqual(pick(() => 0.99));
  });

  it("keeps its progress through save and Continue, without replaying plays", () => {
    const run = session();
    playOne(run);
    playOne(run);
    const restored = fromSaveRecord(toSaveRecord(run.snapshot()), standardDeck, dealers)!;
    const resumed = GameRun.fromSnapshot(dealers, rules, standardDeck, restored, () => 0);
    expect(counters(resumed)).toEqual([2]);
    expect(magicOnField(resumed)).toEqual([]);
    playOne(resumed);
    expect(counters(resumed)).toEqual([3]);
  });

  // The random cursor's rollback is the transaction's own guarantee (game-run tests, #657).
  it("rolls the counter back with a failed action", () => {
    const failing = "test-failing-counter";
    passiveDefinitions.register(failing, {
      ...couldItBeMagicNow,
      id: failing,
      playCounter: { every: 1 },
      eventRules: [
        {
          ...couldItBeMagicNow.eventRules[0]!,
          effects: [
            {
              id: "advance-play-counter",
              config: {
                onReach: [
                  { id: "convert-random-field-card", config: { material: "magic" } },
                  { id: "no-such-command", config: {} },
                ],
              },
            },
          ],
        },
      ],
    });
    const run = new GameRun(dealers, rules, standardDeck, () => 0);
    run.installPassive(createPassiveBlock(failing, "passive.1"));
    const before = run.state;
    let failed = false;
    try {
      failed = run.play({ cardId: run.state.hand[0]!.id }) === null;
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(run.state).toEqual(before);
    expect(counters(run)).toEqual([0]);
  });

  it("keeps progress across a stage change", () => {
    const run = session();
    playOne(run);
    run.forceOutcome("won");
    run.advance();
    run.leaveShop();
    expect(counters(run)).toEqual([1]);
  });
});
