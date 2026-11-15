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

describe("playing a Present from the hand (#1270)", () => {
  it("publishes the revealed card in the wrapper's place in the placed order", async () => {
    const { createPresent, storedPlayable } = await import("./present");
    const run = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0);
    const present = createPresent(
      "present.1",
      storedPlayable({ ...standardDeck[5]!, id: "contents.1" }),
    );
    const snapshot = run.snapshot();
    const resumed = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, {
      ...snapshot,
      state: { ...snapshot.state, hand: [present, ...snapshot.state.hand] },
    });
    expect(resumed.play({ cardId: "present.1" })).not.toBeNull();
    // Presentation matches the played source to what landed by this order, not by its own ID.
    expect(resumed.lastPlacedOrder).toEqual(["contents.1"]);
    expect(resumed.state.field.map(({ block }) => block.id)).toEqual(["contents.1"]);
  });
});

describe("the certified production Present wrapper (#1151; doc/release-status.md)", () => {
  it("shows no provisional warning on the stage-three Present's inspection", async () => {
    const { inspectBlock } = await import("./traits/inspectable");
    const run = wonRun(stageKinds.at(-1)!);
    run.claimStageRewards();
    const text = inspectBlock(presentsIn(run)[0]!)!.toLowerCase();
    expect(text).not.toContain("provisional");
    expect(text).not.toContain("experimental");
  });

  it("is certified, yet stays out of every normal material catalogue", async () => {
    const { getMaterialDefinition, materialDefinitions, materialPools, experimentalMaterials } =
      await import("./materials");
    expect(getMaterialDefinition("giftWrap" as never).releaseStatus).toEqual({ certified: {} });
    const ids = (list: readonly { id: string }[]) => list.map(({ id }) => id);
    expect(ids(materialDefinitions)).not.toContain("giftWrap");
    expect(ids(materialPools.get("gameplay")())).not.toContain("giftWrap");
    // Only the wrapper is certified; every other experimental definition stays provisional.
    const certified = experimentalMaterials
      .filter(({ releaseStatus }) => "certified" in releaseStatus)
      .map(({ id }) => id)
      .sort();
    expect(certified).toEqual(["giftWrap"]);
  });

  it("never wraps a Present's payload in gift wrap", () => {
    for (let round = 0; round < 6; round++) {
      const run = wonRun(stageKinds.at(-1)!);
      run.claimStageRewards();
      const payload = [presentsIn(run)[0]!.traits.opaqueContainer ?? []].flat()[0]!.payload;
      expect((payload.components as { material: string }).material).not.toBe("giftWrap");
    }
  });
});
