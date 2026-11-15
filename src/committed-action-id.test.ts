import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { demoRunRules } from "./run-rules";

describe("committed action identity (#881)", () => {
  it("names each committed action, so its presentation responses have an occurrence", () => {
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
    expect(game.lastCommittedActionId).toBeNull();
    game.play({ cardId: game.state.hand[0]!.id });
    const first = game.lastCommittedActionId;
    expect(first).toBeTruthy();
    expect(game.discard(game.state.hand[0]!.id)).not.toBeNull();
    expect(game.lastCommittedActionId).toBeTruthy();
    expect(game.lastCommittedActionId).not.toBe(first);
  });

  it("never repeats an occurrence across runs, though each run's action counter restarts", () => {
    const one = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
    const two = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
    one.play({ cardId: one.state.hand[0]!.id });
    two.play({ cardId: two.state.hand[0]!.id });
    expect(one.lastCommittedActionId).not.toBe(two.lastCommittedActionId);
  });
});
