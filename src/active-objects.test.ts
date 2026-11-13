import { describe, expect, it } from "vite-plus/test";
import { activeComponentCodecs } from "./active-objects";
import { standardDeck, type CardBlock } from "./cards";
import { dealerRegistry } from "./dealer";
import { devRanklessActive } from "./dev-rankless-active";
import { GameRun, type RunSnapshot } from "./game-run";
import type { GameState } from "./game-state";
import { demoRunRules } from "./run-rules";
import { fromSaveRecord, toSaveRecord } from "./save";

const opening = () => new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0).snapshot();

/** A snapshot with the rankless active placed in one zone. */
function withRankless(zone: "hand" | "deck" | "discardPile" | "field"): RunSnapshot {
  const base = opening();
  const rankless = devRanklessActive("dev-rankless-1");
  const state: GameState =
    zone === "field"
      ? {
          ...base.state,
          field: [
            {
              block: { ...rankless, traits: { ...rankless.traits, selectable: undefined } },
              cell: { x: 0, y: 0, z: 0 },
            },
          ],
        }
      : { ...base.state, [zone]: [...base.state[zone], rankless] };
  return { ...base, state };
}

const roundTrip = (snapshot: RunSnapshot) =>
  fromSaveRecord(JSON.parse(JSON.stringify(toSaveRecord(snapshot))), standardDeck, dealerRegistry);

const idsIn = (blocks: readonly CardBlock[]) => blocks.map(({ id }) => id);

describe("active objects in saves (#894)", () => {
  for (const zone of ["hand", "deck", "discardPile", "field"] as const)
    it(`saves and continues a rankless active in the ${zone}`, () => {
      const snapshot = withRankless(zone);
      const record = toSaveRecord(snapshot);
      expect(record.state.activeObjects).toEqual({
        "dev-rankless-1": { definition: "devRanklessActive", components: {} },
      });
      const restored = roundTrip(snapshot);
      expect(restored).not.toBeNull();
      const blocks =
        zone === "field" ? restored!.state.field.map(({ block }) => block) : restored!.state[zone];
      const active = blocks.find(({ id }) => id === "dev-rankless-1")!;
      expect(active.traits.identity).toBeUndefined();
      expect(active.traits.active).toEqual({ definition: "devRanklessActive" });
    });

  it("leaves a run without active instances exactly as before", () => {
    const snapshot = opening();
    const record = toSaveRecord(snapshot);
    expect(record.state).not.toHaveProperty("activeObjects");
    expect(idsIn(roundTrip(snapshot)!.state.hand)).toEqual(idsIn(snapshot.state.hand));
  });

  it("round-trips registered component state through its codec", () => {
    activeComponentCodecs.register("test-charge", {
      save: (block) => (block.traits as { charge?: number }).charge,
      restore: (block, saved) => {
        if (typeof saved !== "number") throw new Error("bad charge");
        return { ...block, traits: { ...block.traits, charge: saved } } as CardBlock;
      },
    });
    const snapshot = withRankless("hand");
    const charged = {
      ...snapshot,
      state: {
        ...snapshot.state,
        hand: snapshot.state.hand.map((block) =>
          block.id === "dev-rankless-1"
            ? ({ ...block, traits: { ...block.traits, charge: 3 } } as CardBlock)
            : block,
        ),
      },
    };
    const restored = roundTrip(charged)!;
    const active = restored.state.hand.find(({ id }) => id === "dev-rankless-1")!;
    expect((active.traits as { charge?: number }).charge).toBe(3);
  });

  it("rejects unknown definitions or codecs, bad components, duplicates and stray records", () => {
    const record = () => JSON.parse(JSON.stringify(toSaveRecord(withRankless("hand"))));
    const load = (value: unknown) => fromSaveRecord(value, standardDeck, dealerRegistry);
    const unknownDefinition = record();
    unknownDefinition.state.activeObjects["dev-rankless-1"].definition = "nope";
    expect(load(unknownDefinition)).toBeNull();
    const unknownCodec = record();
    unknownCodec.state.activeObjects["dev-rankless-1"].components = { nope: 1 };
    expect(load(unknownCodec)).toBeNull();
    const badComponents = record();
    badComponents.state.activeObjects["dev-rankless-1"].components = [];
    expect(load(badComponents)).toBeNull();
    // An active record whose ID is already an ordinary card's.
    const duplicate = record();
    const ordinary = duplicate.state.hand[0];
    duplicate.state.activeObjects[ordinary] = { definition: "devRanklessActive", components: {} };
    expect(load(duplicate)).toBeNull();
    // A record no zone refers to, and a zone reference with no record.
    const stray = record();
    stray.state.activeObjects["dev-rankless-2"] = {
      definition: "devRanklessActive",
      components: {},
    };
    expect(load(stray)).toBeNull();
    const missing = record();
    delete missing.state.activeObjects;
    expect(load(missing)).toBeNull();
  });
});
