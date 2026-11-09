import { describe, expect, it } from "vite-plus/test";
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
import { createPassiveBlock } from "./passives";

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
    const resumed = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, snapshot);
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
    reject({ ...good, phase: "lobby" });
    reject({ ...good, round: 0 });
    reject({ ...good, state: { ...good.state, hand: [...good.state.hand, "Z-stars"] } });
    reject({ ...good, state: { ...good.state, deck: [...good.state.deck, good.state.hand[0]] } });
    reject({ ...good, state: { ...good.state, deck: good.state.deck.slice(1) } });
    reject({ ...good, state: { ...good.state, round: { ...good.state.round, score: "lots" } } });
    reject({ ...good, state: { ...good.state, coins: -1 } });
    reject({ ...good, state: { ...good.state, coins: 1.5 } });
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
    session.installPassive(createPassiveBlock("do-nothing", "passive.1"));
    const record = JSON.parse(JSON.stringify(toSaveRecord(session.snapshot())));
    const restored = fromSaveRecord(record, standardDeck, dealerRegistry)?.state.passiveRack;
    expect(restored?.map(({ id, definitionId }) => ({ id, definitionId }))).toEqual([
      { id: "passive.1", definitionId: "do-nothing" },
    ]);
    expect(restored?.[0].traits.inspectable.inspect()).toBe(
      "Do Nothing — Has no effect. Unlimited use.",
    );
    delete record.state.passiveRack;
    expect(fromSaveRecord(record, standardDeck, dealerRegistry)?.state.passiveRack).toEqual([]);
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
