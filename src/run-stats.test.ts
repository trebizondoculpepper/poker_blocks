import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { emptyRunStats, parseRunStats, recordPlay, recordRoundComplete } from "./run-stats";
import { fromSaveRecord, toSaveRecord } from "./save";
import { demoRunRules } from "./run-rules";

describe("run stats", () => {
  it("counts plays and points, and keeps the best round", () => {
    let stats = recordPlay(recordPlay(emptyRunStats, 30), 20);
    expect(stats).toMatchObject({
      blocksPlayed: 2,
      totalScore: 50,
      roundScore: 50,
      bestRoundScore: 50,
    });
    stats = recordRoundComplete(stats);
    stats = recordPlay(stats, 10);
    expect(stats).toMatchObject({
      roundsCompleted: 1,
      totalScore: 60,
      roundScore: 10,
      bestRoundScore: 50,
    });
  });

  it("reads missing or bad saved stats as zeros", () => {
    expect(parseRunStats(undefined)).toEqual(emptyRunStats);
    expect(parseRunStats({ totalScore: "x", blocksPlayed: 4 })).toEqual({
      ...emptyRunStats,
      blocksPlayed: 4,
    });
  });

  it("is kept by the run through plays, a completed round and a save", () => {
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0);
    game.play({ cardId: game.state.hand[0].id });
    expect(game.stats.blocksPlayed).toBe(1);
    for (let stage = 0; stage < 3; stage++) {
      game.forceOutcome("won");
      game.advance();
      if (stage < 2) game.leaveShop();
    }
    expect(game.phase).toBe("shop");
    expect(game.stats.roundsCompleted).toBe(1);
    const record = JSON.parse(JSON.stringify(toSaveRecord(game.snapshot())));
    expect(fromSaveRecord(record, standardDeck, dealerRegistry)!.stats).toEqual(game.stats);
  });
});

describe("the dev1 sandbox config", () => {
  it("gives every stage unlimited plays and discards, and no way to win or lose", async () => {
    const { unlimited, sandboxRunRules } = await import("./run-rules");
    const config = sandboxRunRules(demoRunRules);
    const game = new GameRun(dealerRegistry, config, standardDeck, () => 0);
    expect(game.state.round.movesLeft).toBe(unlimited);
    expect(game.state.round.discardsLeft).toBe(unlimited);
    expect(game.state.round.targetScore).toBe(unlimited);
    game.play({ cardId: game.state.hand[0].id });
    expect(game.advance()).toBe(false);
  });
});
