import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { Registry } from "./core/registry";
import { baseDealer, type Dealer } from "./dealer";
import { GameRun } from "./game-run";
import { passiveTraits, type GameEvent, type PassiveBlock, type PassiveRule } from "./passives";
import type { RunRules, StageKind } from "./run-rules";
import { inspectable } from "./traits/inspectable";

const lifecycleTypes = [
  "stage.started",
  "stage.won",
  "stage.lost",
  "reward.finalized",
  "shop.entered",
  "shop.left",
];
const targets: Record<StageKind, number> = { "stage-1": 10, "stage-2": 20, boss: 30 };
const bossDealer: Dealer = { ...baseDealer, name: "boss" };

const dealers = new Registry<Dealer>("dealer");
dealers.register(baseDealer.name, baseDealer);
dealers.register(bossDealer.name, bossDealer);
const config: RunRules = {
  stage: (round, kind) => ({
    dealer: kind === "boss" ? "boss" : "base",
    targetScore: targets[kind] * round,
    plays: 3,
    discards: 2,
  }),
  handAtStageEnd: "return-to-deck",
  discardPileAfterShop: "keep-out",
};
const makeSession = () => new GameRun(dealers, config, standardDeck, () => 0);

/** A rack passive that records every lifecycle event it hears, with its context. */
const heard: GameEvent[] = [];
passiveTraits.register("test.lifecycle.recorder", {
  id: "test.lifecycle.recorder",
  listensTo: lifecycleTypes,
  respond: (_, event) => {
    heard.push(event);
    return [];
  },
});
const passive = (id: string, traitId: string, rules: PassiveRule[] = []): PassiveBlock => ({
  id,
  definitionId: id,
  traits: {
    rackResident: { zone: "passive-rack" },
    passive: { traitId, rules },
    inspectable: inspectable(id),
  },
});
const recording = () => {
  heard.length = 0;
  const session = makeSession();
  session.installPassive(passive("recorder", "test.lifecycle.recorder"));
  return session;
};
const summary = () =>
  heard.map(({ type, stage }) => `${type} ${stage ? `${stage.round}:${stage.kind}` : "-"}`);

describe("session lifecycle events (issue #13)", () => {
  it("announces each stage and shop moment with its round, stage kind and dealer", () => {
    const session = recording();
    for (let stage = 0; stage < 3; stage++) {
      session.forceOutcome("won");
      session.advance();
      session.leaveShop();
    }
    expect(summary()).toEqual([
      "stage.won 1:stage-1",
      "reward.finalized 1:stage-1",
      "shop.entered 1:stage-1",
      "shop.left 1:stage-1",
      "stage.started 1:stage-2",
      "stage.won 1:stage-2",
      "reward.finalized 1:stage-2",
      "shop.entered 1:stage-2",
      "shop.left 1:stage-2",
      "stage.started 1:boss",
      "stage.won 1:boss",
      "reward.finalized 1:boss",
      "shop.entered 1:boss",
      "shop.left 1:boss",
      "stage.started 2:stage-1",
    ]);
    const boss = heard.find(({ type, stage }) => type === "stage.won" && stage?.kind === "boss");
    expect(boss?.stage).toEqual({ round: 1, kind: "boss", dealer: "boss" });
    const reward = heard.find(({ type }) => type === "reward.finalized");
    expect(reward?.reward).toEqual({ coins: 4, balanceBefore: 0, balance: 4 });
  });

  it("announces a stage's outcome and reward once, however often it is asked", () => {
    const session = recording();
    session.forceOutcome("won");
    session.forceOutcome("won");
    session.claimStageRewards();
    session.claimStageRewards();
    session.advance();
    expect(summary()).toEqual([
      "stage.won 1:stage-1",
      "reward.finalized 1:stage-1",
      "shop.entered 1:stage-1",
    ]);
    expect(session.state.coins).toBe(4);
  });

  it("announces a loss without any reward", () => {
    const session = recording();
    session.forceOutcome("lost");
    expect(session.claimStageRewards()).toBeNull();
    session.advance();
    expect(summary()).toEqual(["stage.lost 1:stage-1"]);
    expect(session.phase).toBe("over");
    expect(session.state.coins).toBe(0);
  });

  it("does not announce a decided stage again after it is saved and restored", () => {
    const session = recording();
    session.forceOutcome("won");
    const restored = GameRun.fromSnapshot(dealers, config, standardDeck, session.snapshot());
    heard.length = 0;
    restored.advance();
    expect(summary()).toEqual(["reward.finalized 1:stage-1", "shop.entered 1:stage-1"]);
  });

  it("lets a passive pay only for a boss win by a stage condition, after the base bonus", () => {
    const session = makeSession();
    session.installPassive(
      passive("boss-bounty", "passive.event-rules", [
        {
          on: "stage.won",
          condition: { kind: "stage", kinds: ["boss"] },
          effect: { kind: "add-coins", amount: 3 },
        },
      ]),
    );
    const paid: number[][] = [];
    for (let stage = 0; stage < 3; stage++) {
      session.forceOutcome("won");
      paid.push(session.claimStageRewards()!.entries.map(({ coins }) => coins));
      session.advance();
      session.leaveShop();
    }
    expect(paid).toEqual([[4], [4], [4, 3]]);
    expect(session.state.coins).toBe(15);
  });
});
