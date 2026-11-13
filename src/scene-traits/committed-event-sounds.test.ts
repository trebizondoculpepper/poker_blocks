import { describe, expect, it } from "vite-plus/test";
import type { EventEnvelope } from "../lifecycle/action";
import { committedEventSounds } from "./committed-event-sounds";

const fact = (payload: object): EventEnvelope =>
  ({
    eventId: "e",
    type: "t",
    actionId: "a",
    sequence: 0,
    parentId: null,
    phase: "discard",
    batchId: null,
    subjectIds: [],
    snapshotVersion: 1,
    context: null,
    payload,
  }) as EventEnvelope;

/** A run that publishes facts on demand, and a sound service that records what it is asked. */
function host() {
  const listeners = new Set<(facts: readonly EventEnvelope[]) => void>();
  const played: string[] = [];
  const context = {
    services: {
      run: {
        onCommitted(listener: (facts: readonly EventEnvelope[]) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      sound: (id: string) => void played.push(id),
    },
  };
  const commit = (...payloads: object[]) => {
    for (const listener of Array.from(listeners)) listener(payloads.map(fact));
  };
  return { context, played, commit, listeners };
}

describe("committedEventSounds (#755)", () => {
  it("plays each committed fact's configured sound once, in first-named order", () => {
    const { context, played, commit } = host();
    const trait = committedEventSounds<typeof context>();
    trait.enter!(context as never, {});
    commit(
      { type: "coins.gained", amount: 1, sound: "passive.coins" },
      { type: "discard.completed" },
      { type: "coins.gained", amount: 1, sound: "passive.coins" },
      { type: "passive.installed", sound: "passive.granted" },
    );
    expect(played).toEqual(["passive.coins", "passive.granted"]);
  });

  it("presents plays as well as discards: it reads the facts, never the action kind", () => {
    const { context, played, commit } = host();
    committedEventSounds<typeof context>().enter!(context as never, {});
    commit({ type: "stage.won", sound: "passive.coins" });
    expect(played).toEqual(["passive.coins"]);
  });

  it("stops listening when its scene leaves, and never subscribes twice", () => {
    const { context, played, commit, listeners } = host();
    const trait = committedEventSounds<typeof context>();
    trait.enter!(context as never, {});
    trait.enter!(context as never, {});
    expect(listeners.size).toBe(1);
    trait.exit!(context as never, {});
    commit({ type: "coins.gained", sound: "passive.coins" });
    expect(played).toEqual([]);
    expect(listeners.size).toBe(0);
  });
});
