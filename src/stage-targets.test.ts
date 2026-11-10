import { describe, expect, it } from "vite-plus/test";
import { stageTargetBalance } from "./balance";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { demoRunRules, sandboxRunRules, targetForStage, unlimited } from "./run-rules";

describe("stage target progression (#137)", () => {
  it("rounds after every step, including the boss-to-next-round transition", () => {
    const targets = [1, 2, 3].flatMap((round) =>
      stageTargetBalance.stages.map(({ kind }) => demoRunRules.stage(round, kind).targetScore),
    );
    expect(targets).toEqual([300, 525, 788, 985, 1724, 2586, 3233, 5658, 8487]);
  });

  it("uses a different ordered stage sequence and rates without changing the calculator", () => {
    const custom = {
      openingTarget: 7,
      stages: [
        { kind: "opening", rateInto: 3 },
        { kind: "finale", rateInto: 2 },
      ],
    } as const;
    expect([
      targetForStage(custom, 1, "opening"),
      targetForStage(custom, 1, "finale"),
      targetForStage(custom, 2, "opening"),
      targetForStage(custom, 2, "finale"),
    ]).toEqual([7, 14, 42, 84]);
  });

  it("keeps the developer sandbox target effectively endless", () => {
    const sandbox = sandboxRunRules(demoRunRules);
    expect(sandbox.stage(1, "stage-1").targetScore).toBe(unlimited);
    expect(sandbox.stage(2, "boss").targetScore).toBe(unlimited);
  });

  it("keeps an older saved target until the next stage is dealt", () => {
    const run = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0);
    const snapshot = run.snapshot();
    const resumed = GameRun.fromSnapshot(
      dealerRegistry,
      demoRunRules,
      standardDeck,
      {
        ...snapshot,
        state: {
          ...snapshot.state,
          round: { ...snapshot.state.round, targetScore: 100 },
        },
      },
      () => 0,
    );
    expect(resumed.state.round.targetScore).toBe(100);
    expect(resumed.forceOutcome("won")).toBe(true);
    expect(resumed.advance()).toBe(true);
    expect(resumed.leaveShop()).toBe(true);
    expect(resumed.state.round.targetScore).toBe(525);
  });
});
