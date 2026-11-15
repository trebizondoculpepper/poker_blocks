import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { demoRunRules, stageKinds } from "./run-rules";
import { fromSaveRecord, toSaveRecord } from "./save";
import { Randomizer } from "./random";

/** A seeded run, its stage decided as won, on the given stage of round one. */
function wonRun(stage: (typeof stageKinds)[number]) {
  const randomizer = new Randomizer(7);
  const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => randomizer.next());
  game.attachRandomCheckpoints(randomizer);
  const snapshot = game.snapshot();
  const run = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, {
    ...snapshot,
    phase: stage,
  });
  run.attachRandomCheckpoints(randomizer);
  run.forceOutcome("won");
  return run;
}
const presentsIn = (run: GameRun) =>
  run.state.deck.filter((card) => [card.traits.active ?? []].flat()[0]?.definition === "present");

describe("a Present on winning the round's last stage (#651; doc/presents.md)", () => {
  it("adds one Present row after the cash rows and one wrapped card to the deck", () => {
    const run = wonRun(stageKinds.at(-1)!);
    const deckBefore = run.state.deck.length;
    const reward = run.claimStageRewards()!;
    const last = reward.entries.at(-1)!;
    expect(last.presentation).toBe("present");
    expect(reward.entries.slice(0, -1).every(({ presentation }) => presentation === "coins")).toBe(
      true,
    );
    const presents = presentsIn(run);
    expect(presents).toHaveLength(1);
    expect(run.state.deck).toHaveLength(deckBefore + 1);
    expect((last.effects[0]!.config as { granted: string[] }).granted).toEqual([presents[0]!.id]);
    // Its contents are fixed now: a playable card, never Paper.
    const payload = [presents[0]!.traits.opaqueContainer ?? []].flat()[0]!.payload;
    expect(payload.definition).toBe("playableCard");
    expect((payload.components as { material: string }).material).not.toBe("paper");
  });

  it("says it holds an unknown playable card, and never what, even after a save", async () => {
    const { inspectBlock } = await import("./traits/inspectable");
    const run = wonRun(stageKinds.at(-1)!);
    run.claimStageRewards();
    const [present] = presentsIn(run);
    const text = inspectBlock(present!)!;
    expect(text).toContain("An unknown playable card, wrapped");
    const payload = [present!.traits.opaqueContainer ?? []].flat()[0]!.payload;
    const { material } = payload.components as { material: string };
    expect(text.toLowerCase()).not.toContain(` ${material.toLowerCase()} `);
    const record = JSON.parse(JSON.stringify(toSaveRecord(run.snapshot())));
    const snapshot = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    const resumed = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, snapshot);
    expect(inspectBlock(presentsIn(resumed)[0]!)).toContain("An unknown playable card, wrapped");
  });

  it("grants nothing on the earlier stages of the round", () => {
    const run = wonRun(stageKinds[0]!);
    const reward = run.claimStageRewards()!;
    expect(reward.entries.some(({ presentation }) => presentation === "present")).toBe(false);
    expect(presentsIn(run)).toHaveLength(0);
  });

  it("is granted exactly once, and survives save and Continue with the same contents", () => {
    const run = wonRun(stageKinds.at(-1)!);
    const reward = run.claimStageRewards()!;
    expect(run.claimStageRewards()).toBe(reward);
    expect(presentsIn(run)).toHaveLength(1);
    const record = JSON.parse(JSON.stringify(toSaveRecord(run.snapshot())));
    const snapshot = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    const resumed = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, snapshot);
    resumed.claimStageRewards();
    const [before] = presentsIn(run);
    const after = presentsIn(resumed);
    expect(after).toHaveLength(1);
    expect(after[0]!.traits.opaqueContainer).toEqual(before!.traits.opaqueContainer);
  });
});
