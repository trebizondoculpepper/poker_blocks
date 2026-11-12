import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { Registry } from "./core/registry";
import { baseDealer, type Dealer } from "./dealer";
import { GameRun } from "./game-run";
import { passiveActivations } from "./passive-effects";
import { passiveTraits, type GameEvent, type PassiveBlock } from "./passives";
import type { EventRule } from "./event-rules";
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
const passive = (id: string, traitId: string, eventRules: EventRule[] = []): PassiveBlock => ({
  id,
  definitionId: id,
  traits: {
    rackResident: { zone: "passive-rack" },
    passive: { traitId, eventRules },
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
    expect(boss?.stage).toEqual({
      round: 1,
      ordinal: 3,
      instance: "1.3",
      kind: "boss",
      dealer: "boss",
    });
    const reward = heard.find(({ type }) => type === "reward.finalized");
    // The completion bonus (4) and a coin for each of the three unused plays.
    expect(reward?.reward).toEqual({ coins: 7, balanceBefore: 0, balance: 7 });
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
    expect(session.state.coins).toBe(7);
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
          select: { id: "won-stage", config: {} },
          where: { id: "stage-in", config: { stages: ["boss"] } },
          effects: [{ id: "add-coins", config: { amount: 3 } }],
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
    // Bonus, three unused plays, then the boss bounty on the boss only.
    expect(paid).toEqual([
      [4, 3],
      [4, 3],
      [4, 3, 3],
    ]);
    expect(session.state.coins).toBe(24);
  });
});

describe("numbered stage lifecycle (#660)", () => {
  /** Play `stages` stages through, winning each, recording what the rack heard. */
  const playThrough = (session: GameRun, stages: number) => {
    for (let stage = 0; stage < stages; stage++) {
      session.forceOutcome("won");
      session.advance();
      session.leaveShop();
    }
  };

  it("carries each stage's round, ordinal and instance on start, win and loss", () => {
    const session = recording();
    playThrough(session, 4);
    const won = heard.filter(({ type }) => type === "stage.won").map(({ stage }) => stage);
    expect(won.map((stage) => `${stage?.round}.${stage?.ordinal}`)).toEqual([
      "1.1",
      "1.2",
      "1.3",
      "2.1",
    ]);
    expect(won.map((stage) => stage?.instance)).toEqual(["1.1", "1.2", "1.3", "2.1"]);
  });

  /** The stage.started events of six stages, as the run emitted them, and which a rule matches. */
  const matchedStarts = (where: EventRule["where"]) => {
    const session = recording();
    playThrough(session, 6);
    const rule = passive("matcher", "passive.event-rules", [
      { on: "stage.started", select: { id: "event-stage", config: {} }, where, effects: [] },
    ]);
    return heard
      .filter(({ type }) => type === "stage.started")
      .map((event) => ({
        at: `${event.stage?.round}.${event.stage?.ordinal}`,
        matched: passiveActivations(rule, event).length > 0,
      }));
  };

  it("lets a rule target stage two in every round, never stage one or three", () => {
    expect(matchedStarts({ id: "stage-ordinal-in", config: { ordinals: [2] } })).toEqual([
      { at: "1.2", matched: true },
      { at: "1.3", matched: false },
      { at: "2.1", matched: false },
      { at: "2.2", matched: true },
      { at: "2.3", matched: false },
      { at: "3.1", matched: false },
    ]);
  });

  it("narrows to one round when the rule names it", () => {
    const matched = matchedStarts({
      id: "stage-ordinal-in",
      config: { ordinals: [2], rounds: [2] },
    })
      .filter(({ matched }) => matched)
      .map(({ at }) => at);
    expect(matched).toEqual(["2.2"]);
  });

  it("does not replay a stage's start when a run is restored", () => {
    const session = recording();
    playThrough(session, 1);
    const restoredFrom = session.snapshot();
    heard.length = 0;
    const restored = GameRun.fromSnapshot(dealers, config, standardDeck, restoredFrom);
    restored.installPassive(passive("recorder-2", "test.lifecycle.recorder"));
    expect(heard.filter(({ type }) => type === "stage.started")).toEqual([]);
  });
});
