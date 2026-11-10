import { describe, expect, it } from "vite-plus/test";
import { fixedRandom } from "./random";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import {
  clearRun,
  fromSaveRecord,
  loadRun,
  saveKey,
  saveRun,
  toSaveRecord,
  type SaveStorage,
} from "./save";
import { demoRunRules } from "./run-rules";
import { createPassiveBlock, passiveDefinitions } from "./passives";

function memoryStorage(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const brokenStorage: SaveStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

function playedSession(): GameRun {
  const session = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0);
  session.play({ cardId: session.state.hand[0].id });
  session.refillHand();
  session.discard(session.state.hand[0].id);
  session.refillHand();
  return session;
}

describe("save records", () => {
  it("round-trips a run through JSON", () => {
    const session = playedSession();
    const json = JSON.parse(JSON.stringify(toSaveRecord(session.snapshot())));
    const snapshot = fromSaveRecord(json, standardDeck, dealerRegistry)!;
    expect(snapshot).toEqual(session.snapshot());
    expect(snapshot.state.field[0].block.traits.selectable).toBeUndefined();
    const resumed = GameRun.fromSnapshot(
      dealerRegistry,
      demoRunRules,
      standardDeck,
      snapshot,
      fixedRandom(),
    );
    expect(resumed.snapshot()).toEqual(session.snapshot());
    const all = [
      ...resumed.state.field.map(({ block }) => block.id),
      ...resumed.state.hand.map(({ id }) => id),
      ...resumed.state.deck.map(({ id }) => id),
      ...resumed.state.discardPile.map(({ id }) => id),
    ];
    expect(new Set(all).size).toBe(52);
    expect(all).toHaveLength(52);
  });

  it("rejects corrupt, unknown-version and inconsistent records", () => {
    const good = toSaveRecord(playedSession().snapshot());
    const reject = (value: unknown) =>
      expect(fromSaveRecord(value, standardDeck, dealerRegistry)).toBeNull();
    reject(null);
    reject("nonsense");
    reject({ ...good, version: 2 });
    reject({ ...good, dealer: "nobody" });
    reject({ ...good, scene: "lobby" });
    reject({ ...good, scene: "game-over" });
    reject({ ...good, scene: undefined, phase: "lobby" });
    reject({ ...good, round: 0 });
    reject({ ...good, state: { ...good.state, hand: [...good.state.hand, "Z-stars"] } });
    reject({ ...good, state: { ...good.state, deck: [...good.state.deck, good.state.hand[0]] } });
    reject({ ...good, state: { ...good.state, deck: good.state.deck.slice(1) } });
    reject({ ...good, state: { ...good.state, round: { ...good.state.round, score: "lots" } } });
    reject({ ...good, state: { ...good.state, coins: -1 } });
    reject({ ...good, state: { ...good.state, coins: 1.5 } });
    reject({ ...good, rewarded: { stage: "1:stage-1", reward: { entries: [], balance: -1 } } });
    reject({
      ...good,
      rewarded: { stage: "bogus", reward: { entries: [], balanceBefore: 0, balance: 0 } },
    });
    reject({
      ...good,
      rewarded: {
        stage: "1:stage-1",
        reward: {
          entries: [{ source: "material.gold", label: "Gold", coins: 2 }],
          balanceBefore: 0,
          balance: 0,
        },
      },
    });
    reject({
      ...good,
      state: { ...good.state, passiveRack: [{ id: "passive.1", definitionId: "unknown" }] },
    });
  });

  it("restores coins and defaults older saves to zero", () => {
    const session = playedSession();
    const record = toSaveRecord(session.snapshot());
    expect(
      fromSaveRecord(
        { ...record, state: { ...record.state, coins: 12 } },
        standardDeck,
        dealerRegistry,
      )?.state.coins,
    ).toBe(12);
    expect(
      fromSaveRecord(
        { ...record, state: { ...record.state, coins: undefined } },
        standardDeck,
        dealerRegistry,
      )?.state.coins,
    ).toBe(0);
  });

  it("restores an ordered passive rack and still reads older saves without one", () => {
    const session = playedSession();
    session.installPassive(createPassiveBlock("double-line", "passive.1"));
    const record = JSON.parse(JSON.stringify(toSaveRecord(session.snapshot())));
    const restored = fromSaveRecord(record, standardDeck, dealerRegistry)?.state.passiveRack;
    expect(restored?.map(({ id, definitionId }) => ({ id, definitionId }))).toEqual([
      { id: "passive.1", definitionId: "double-line" },
    ]);
    expect(restored?.[0].traits.inspectable.inspect()).toContain("×2");
    delete record.state.passiveRack;
    expect(fromSaveRecord(record, standardDeck, dealerRegistry)?.state.passiveRack).toEqual([]);
  });

  it("drops a retired passive from an older save instead of carrying a dead slot", () => {
    // doc/game.md: an older dev2 save with the retired Do Nothing block replaces it while
    // keeping the card run. A retired passive has no effect, so it simply does not come back.
    const session = playedSession();
    session.installPassive(createPassiveBlock("do-nothing", "passive.1"));
    session.installPassive(createPassiveBlock("double-line", "passive.2"));
    const record = JSON.parse(JSON.stringify(toSaveRecord(session.snapshot())));
    const rack = fromSaveRecord(record, standardDeck, dealerRegistry)?.state.passiveRack;

    expect(rack?.map(({ id }) => id)).toEqual(["passive.2"]);
    expect(rack?.every(({ definitionId }) => !passiveDefinitions.get(definitionId).retired)).toBe(
      true,
    );
  });
});

describe("run storage", () => {
  it("keeps dev-mode and normal saves separate", () => {
    const storage = memoryStorage();
    const session = playedSession();
    expect(saveRun(storage, session.snapshot(), "poker-blocks.dev-run")).toBe(true);
    expect(loadRun(storage, standardDeck, dealerRegistry)).toBeNull();
    expect(loadRun(storage, standardDeck, dealerRegistry, "poker-blocks.dev-run")).toEqual(
      session.snapshot(),
    );
  });

  it("saves, loads and clears a run", () => {
    const storage = memoryStorage();
    const session = playedSession();
    expect(saveRun(storage, session.snapshot())).toBe(true);
    expect(loadRun(storage, standardDeck, dealerRegistry)).toEqual(session.snapshot());
    clearRun(storage);
    expect(loadRun(storage, standardDeck, dealerRegistry)).toBeNull();
  });

  it("clears the save when the run is lost", () => {
    const storage = memoryStorage();
    const session = playedSession();
    saveRun(storage, session.snapshot());
    saveRun(storage, { ...session.snapshot(), phase: "over" });
    expect(storage.data.has(saveKey)).toBe(false);
  });

  it("clears only the slot it is given, so a dev mode clears its own save (#149)", () => {
    const storage = memoryStorage();
    const snapshot = playedSession().snapshot();
    saveRun(storage, snapshot);
    saveRun(storage, snapshot, "poker-blocks.dev2-run");

    clearRun(storage, "poker-blocks.dev2-run");

    expect(storage.data.has("poker-blocks.dev2-run")).toBe(false);
    // The normal game's run is untouched.
    expect(loadRun(storage, standardDeck, dealerRegistry)).toEqual(snapshot);
  });

  it("ignores unreadable data and works without storage", () => {
    const storage = memoryStorage();
    storage.setItem(saveKey, "{not json");
    expect(loadRun(storage, standardDeck, dealerRegistry)).toBeNull();
    const snapshot = playedSession().snapshot();
    expect(saveRun(brokenStorage, snapshot)).toBe(false);
    expect(loadRun(brokenStorage, standardDeck, dealerRegistry)).toBeNull();
    expect(saveRun(null, snapshot)).toBe(false);
    expect(() => clearRun(brokenStorage)).not.toThrow();
  });
});

describe("saves record the scene name (#86)", () => {
  /** A legacy record: written before scenes, with `phase` and no `scene`. */
  function legacy(phase: string, extra: object = {}) {
    const { scene: _scene, ...record } = toSaveRecord(playedSession().snapshot());
    return { ...record, phase, ...extra };
  }
  const load = (value: unknown) => fromSaveRecord(value, standardDeck, dealerRegistry);

  it("writes the scene name and no phase", () => {
    const record = toSaveRecord(playedSession().snapshot());
    expect(record.scene).toBe("stage-1");
    expect(record).not.toHaveProperty("phase");
  });

  it("reads the scene through the mode's flow, so a renamed scene still resumes", () => {
    const flow = {
      "run.position.stage-1": { operation: "replace", scene: "boss" },
      "run.position.stage-2": { operation: "replace", scene: "stage-2" },
      "run.position.boss": { operation: "replace", scene: "stage-1" },
      "run.position.shop": { operation: "replace", scene: "shop" },
      "run.position.over": { operation: "replace", scene: "game-over" },
    } as const;
    const snapshot = playedSession().snapshot();
    const record = toSaveRecord(snapshot, flow);
    expect(record.scene).toBe("boss");
    expect(fromSaveRecord(record, standardDeck, dealerRegistry, flow)?.phase).toBe("stage-1");
  });

  it.each(["stage-1", "stage-2", "boss"] as const)("migrates a legacy %s save", (phase) => {
    expect(load(legacy(phase))?.phase).toBe(phase);
  });

  it("migrates a legacy shop save, keeping its stage and defaulting to after the boss", () => {
    expect(load(legacy("shop", { shopAfter: "stage-2" }))).toMatchObject({
      phase: "shop",
      shopAfter: "stage-2",
    });
    const oldShop = load(legacy("shop"))!;
    expect(oldShop.phase).toBe("shop");
    expect(
      GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, oldShop).shopAfterStage,
    ).toBe("boss");
  });

  it("never resumes a legacy lost run, and clears its save", () => {
    const storage = memoryStorage();
    storage.setItem(saveKey, JSON.stringify(legacy("over")));
    expect(loadRun(storage, standardDeck, dealerRegistry)).toBeNull();
    expect(storage.data.has(saveKey)).toBe(false);
  });

  it("invalidates a legacy save with an unknown phase", () => {
    expect(load(legacy("lobby"))).toBeNull();
  });

  it("resumes a migrated save without paying a stage reward twice", () => {
    const session = playedSession();
    const record = { ...toSaveRecord(session.snapshot()), scene: undefined, phase: "stage-1" };
    const restored = load(JSON.parse(JSON.stringify(record)))!;
    expect(restored.rewarded).toEqual(session.snapshot().rewarded);
    expect(restored.state.coins).toBe(session.state.coins);
  });
});
