import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameSession } from "./game-session";
import {
  clearRun,
  fromSaveRecord,
  loadRun,
  saveKey,
  saveRun,
  toSaveRecord,
  type SaveStorage,
} from "./save";
import { demoSessionConfig } from "./session-config";

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

function playedSession(): GameSession {
  const session = new GameSession(dealerRegistry, demoSessionConfig, standardDeck, () => 0);
  session.play({ cardId: session.state.hand[0].id });
  session.refillHand();
  session.discard(session.state.hand[0].id);
  session.refillHand();
  return session;
}

describe("save records", () => {
  it("round-trips a session through JSON", () => {
    const session = playedSession();
    const json = JSON.parse(JSON.stringify(toSaveRecord(session.snapshot())));
    const snapshot = fromSaveRecord(json, standardDeck, dealerRegistry)!;
    expect(snapshot).toEqual(session.snapshot());
    expect(snapshot.state.field[0].block.traits.selectable).toBeUndefined();
    const resumed = GameSession.fromSnapshot(
      dealerRegistry,
      demoSessionConfig,
      standardDeck,
      snapshot,
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
    reject({ ...good, phase: "lobby" });
    reject({ ...good, round: 0 });
    reject({ ...good, state: { ...good.state, hand: [...good.state.hand, "Z-stars"] } });
    reject({ ...good, state: { ...good.state, deck: [...good.state.deck, good.state.hand[0]] } });
    reject({ ...good, state: { ...good.state, deck: good.state.deck.slice(1) } });
    reject({ ...good, state: { ...good.state, round: { ...good.state.round, score: "lots" } } });
  });
});

describe("run storage", () => {
  it("keeps dev-room and normal saves separate", () => {
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
