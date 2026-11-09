import { describe, expect, it } from "vite-plus/test";
import { followFlow, type GameFlow } from "./game-flow";
import { standardGameFlow } from "./game-modes";
import { GameRun } from "./game-run";
import { dealerRegistry } from "./dealer";
import { demoRunRules } from "./run-rules";
import { standardDeck } from "./cards";

describe("mode-owned game flow", () => {
  it("follows the stage, shop and next-round order by outcome", () => {
    const visited: string[] = [];
    const stack = {
      replace: (scene: string) => visited.push(scene),
      push: (scene: string) => visited.push(`over ${scene}`),
      pop: () => visited.push("back"),
    };
    const run = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0);
    const show = () => followFlow(standardGameFlow, run.positionOutcome, stack);
    show();
    for (let stage = 0; stage < 3; stage++) {
      run.forceOutcome("won");
      run.advance();
      show();
      run.leaveShop();
      show();
    }
    run.forceOutcome("lost");
    run.advance();
    show();
    expect(visited).toEqual([
      "stage-1",
      "shop",
      "stage-2",
      "shop",
      "boss",
      "shop",
      "stage-1",
      "game-over",
    ]);
  });

  it("reaches a renamed scene and supports every stack operation without changing the runner", () => {
    type Outcome = "open" | "present" | "back";
    type Scene = "new-stage-name" | "reward";
    const flow: GameFlow<Outcome, Scene> = {
      open: { operation: "replace", scene: "new-stage-name" },
      present: { operation: "push", scene: "reward" },
      back: { operation: "pop" },
    };
    const stack: Scene[] = [];
    const operations = {
      replace: (scene: Scene) => {
        stack.splice(0, stack.length, scene);
      },
      push: (scene: Scene) => {
        stack.push(scene);
      },
      pop: () => {
        stack.pop();
      },
    };
    followFlow(flow, "open", operations);
    followFlow(flow, "present", operations);
    expect(stack).toEqual(["new-stage-name", "reward"]);
    followFlow(flow, "back", operations);
    expect(stack).toEqual(["new-stage-name"]);
  });
});

describe("the round ends after its last stage's shop (#94)", () => {
  function finishRound(rules: typeof demoRunRules) {
    const run = new GameRun(dealerRegistry, rules, standardDeck, () => 0);
    run.discard(run.state.hand.slice(0, 2).map(({ id }) => id));
    for (let stage = 0; stage < 3; stage++) {
      run.forceOutcome("won");
      run.advance();
      run.leaveShop();
    }
    return run;
  }

  it("starts the next round and recycles the discard pile under the run's policy", () => {
    const recycled = finishRound(demoRunRules);
    expect(recycled.round).toBe(2);
    expect(recycled.phase).toBe("stage-1");
    expect(recycled.state.discardPile).toEqual([]);
    const kept = finishRound({ ...demoRunRules, discardPileAfterShop: "keep-out" });
    expect(kept.round).toBe(2);
    expect(kept.state.discardPile).toHaveLength(2);
  });
});
