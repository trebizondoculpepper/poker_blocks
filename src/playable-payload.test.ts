import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { blockMaterials, materialOf } from "./materials";
import { dealerRegistry } from "./dealer";
import { devOpaqueContainer } from "./dev-rankless-active";
import { GameRun } from "./game-run";
import { demoRunRules, sandboxRunRules } from "./run-rules";
import { fromSaveRecord, toSaveRecord } from "./save";
import { materializePayload } from "./playable-payload";

const kingOfHearts = (id: string) => ({
  id,
  definition: "playableCard",
  components: { pokerIdentity: { rank: "K", suit: "hearts" } },
});

/** A run whose hand is exactly these blocks; every other standard card stays in the deck. */
function runWithHand(hand: CardBlock[]) {
  const rules = sandboxRunRules(demoRunRules);
  const opening = new GameRun(dealerRegistry, rules, standardDeck, () => 0);
  return GameRun.fromSnapshot(
    dealerRegistry,
    rules,
    standardDeck,
    {
      ...opening.snapshot(),
      state: {
        ...opening.state,
        hand,
        deck: standardDeck.filter((card) => !hand.some(({ id }) => id === card.id)),
      },
    },
    () => 0,
  );
}

const saved = (run: GameRun) => JSON.parse(JSON.stringify(toSaveRecord(run.snapshot())));
const load = (record: unknown) => fromSaveRecord(record as never, standardDeck, dealerRegistry);

describe("nested playable payloads in saves (#927)", () => {
  it("keeps an unopened payload nested in its container, and continues it", () => {
    const run = runWithHand([devOpaqueContainer("box-1", kingOfHearts("revealed-1"))]);
    const record = saved(run);
    expect(record.state.activeObjects["box-1"].components.opaqueContainer).toEqual(
      kingOfHearts("revealed-1"),
    );
    expect(record.state.activeObjects).not.toHaveProperty("revealed-1");
    expect(load(record)!.state.hand[0]!.traits.opaqueContainer?.payload).toEqual(
      kingOfHearts("revealed-1"),
    );
  });

  it("rebuilds a playable card payload from its components", () => {
    const card = materializePayload("box-1", {
      ...kingOfHearts("revealed-1"),
      components: { pokerIdentity: { rank: "K", suit: "hearts" }, material: blockMaterials[1]! },
    });
    expect(card.traits.identity?.rank).toBe("K");
    expect(card.traits.identity?.suit.name).toBe("hearts");
    expect(materialOf(card)).toBe(blockMaterials[1]);
  });

  it.each([
    [
      "corrupt components",
      (r: any) => (r.components.opaqueContainer.components.pokerIdentity.rank = "X"),
    ],
    ["a missing required component", (r: any) => (r.components.opaqueContainer.components = {})],
    [
      "an unknown payload definition",
      (r: any) => (r.components.opaqueContainer.definition = "nope"),
    ],
    ["an unknown payload codec", (r: any) => (r.components.opaqueContainer.components.nope = 1)],
    [
      "a nested container",
      (r: any) =>
        (r.components.opaqueContainer.components = { opaqueContainer: kingOfHearts("deeper") }),
    ],
    [
      "a payload sharing its container's ID",
      (r: any) => (r.components.opaqueContainer.id = "box-1"),
    ],
    ["a container missing its payload", (r: any) => delete r.components.opaqueContainer],
  ])("rejects a save with %s", (_, corrupt) => {
    const record = saved(runWithHand([devOpaqueContainer("box-1", kingOfHearts("revealed-1"))]));
    corrupt(record.state.activeObjects["box-1"]);
    expect(load(record)).toBeNull();
  });

  it("rejects a payload ID owned twice, or used by a run card", () => {
    const twice = saved(
      runWithHand([
        devOpaqueContainer("box-1", kingOfHearts("same")),
        devOpaqueContainer("box-2", kingOfHearts("same")),
      ]),
    );
    expect(load(twice)).toBeNull();
    const clash = saved(
      runWithHand([devOpaqueContainer("box-1", kingOfHearts(standardDeck[0]!.id))]),
    );
    expect(load(clash)).toBeNull();
  });

  it("decodes a save without containers exactly as before", () => {
    const run = runWithHand([standardDeck[0]!]);
    const record = saved(run);
    expect(record.state.activeObjects).toBeUndefined();
    expect(load(record)!.state.hand.map(({ id }) => id)).toEqual([standardDeck[0]!.id]);
  });
});
