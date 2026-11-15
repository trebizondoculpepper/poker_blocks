import { describe, expect, it } from "vite-plus/test";
import {
  activationOffsetUnits,
  captureActivationOrder,
  createActivationSequences,
  presentActivationOrder,
} from "./rack-activation-presentation";
import { rackActivationPulse } from "./rack-pulses";
import { staggerSpacingUnits } from "./visual-events/stagger";
import { createVisualScheduler, unitMs, type EffectHandle } from "./visual-events/scheduler";

/** Every pulse the host started, and when: one log, so ordering is checked directly. */
type Started = { sourceId: string; atMs: number };

/**
 * A host standing in for the rack: the sources it presents, and a pulse that lasts `pulseMs` from
 * its own start and is put back when it ends.
 */
function host(presents: readonly string[], pulseMs = 450) {
  const started: Started[] = [];
  const stopped: string[] = [];
  const host = {
    presents: (sourceId: string) => presents.includes(sourceId),
    pulse(sourceId: string, fromMs: number, nowMs: number): EffectHandle | null {
      // An item that isn't in the rack has no pulse to show.
      if (!host.presents(sourceId)) return null;
      if (nowMs >= fromMs + pulseMs) return null;
      started.push({ sourceId, atMs: fromMs });
      const until = fromMs + pulseMs;
      let done = false;
      const stop = () => {
        if (done) return;
        done = true;
        stopped.push(sourceId);
      };
      return {
        update: (at) => (at >= until ? (stop(), "finished" as const) : ("running" as const)),
        cancel: stop,
        dispose: stop,
      };
    },
  };
  return { host, started, stopped };
}

/** A scheduler whose handler is the real one, showing through `host`. */
function scheduling(pulses: ReturnType<typeof host>) {
  const scheduler = createVisualScheduler({ services: { rackPulses: pulses.host } });
  let real = 0;
  scheduler.update(real, true);
  /** Advance the presentation clock by `ms`, one 10 ms frame at a time. */
  const advance = (ms: number) => {
    for (let done = 0; done < ms; done += 10) scheduler.update((real += 10), true);
  };
  return { scheduler, advance };
}

describe("a line's activation order, captured at commit (#540)", () => {
  it("keeps the committed order, drops sources the host doesn't show, and repeats none", () => {
    const order = captureActivationOrder(["passive.2", "card-rule", "passive.1", "passive.2"], {
      presents: (sourceId) => sourceId.startsWith("passive."),
    });
    expect(order).toEqual(["passive.2", "passive.1"]);
  });

  it("starts the first activation at once and each later one a spacing apart, in units", () => {
    const pulses = host(["passive.1", "passive.2", "passive.3"]);
    const { scheduler, advance } = scheduling(pulses);
    const scope = presentActivationOrder(
      scheduler,
      ["passive.1", "passive.2", "passive.3"],
      scheduler.nowMs / unitMs,
    );
    expect(scope).not.toBeNull();
    advance(600);
    // 2 units is 133⅓ ms: t, t+133⅓, t+266⅔.
    expect(pulses.started.map(({ sourceId }) => sourceId)).toEqual([
      "passive.1",
      "passive.2",
      "passive.3",
    ]);
    const [first, second, third] = pulses.started.map(({ atMs }) => atMs);
    expect(second! - first!).toBeCloseTo(staggerSpacingUnits * unitMs, 6);
    expect(third! - second!).toBeCloseTo(staggerSpacingUnits * unitMs, 6);
  });

  it("uses a caller's configured spacing instead of the default", () => {
    const pulses = host(["passive.1", "passive.2"]);
    const { scheduler, advance } = scheduling(pulses);
    presentActivationOrder(scheduler, ["passive.1", "passive.2"], scheduler.nowMs / unitMs, {
      spacingUnits: 5,
    });
    advance(600);
    const [first, second] = pulses.started.map(({ atMs }) => atMs);
    expect(second! - first!).toBeCloseTo(5 * unitMs, 6);
  });

  it("starts nothing, and creates no scope, when the host presents no source", () => {
    const pulses = host([]);
    const { scheduler } = scheduling(pulses);
    expect(presentActivationOrder(scheduler, [], scheduler.nowMs / unitMs)).toBeNull();
    expect(pulses.started).toEqual([]);
  });

  it("places each activation's label with its own pulse, not with the line", () => {
    expect(activationOffsetUnits(0)).toBe(0);
    expect(activationOffsetUnits(2)).toBe(2 * staggerSpacingUnits);
  });
});

describe("an activation sequence's lifecycle (#540)", () => {
  it("leaves an activation that has left the rack as an empty slot, not a shorter sequence", () => {
    // The three-item order was captured with the play; the middle item is sold before it starts.
    const pulses = host(["passive.1", "passive.3"]);
    const { scheduler, advance } = scheduling(pulses);
    presentActivationOrder(
      scheduler,
      ["passive.1", "passive.2", "passive.3"],
      scheduler.nowMs / unitMs,
    );
    advance(600);
    expect(pulses.started.map(({ sourceId }) => sourceId)).toEqual(["passive.1", "passive.3"]);
    const [first, third] = pulses.started.map(({ atMs }) => atMs);
    // The missing item's slot is kept: the third still starts two spacings after the first.
    expect(third! - first!).toBeCloseTo(2 * staggerSpacingUnits * unitMs, 6);
  });

  it("shows nothing for a pulse whose interval already ended before its start was dispatched", () => {
    const pulses = host(["passive.1"], 20);
    const scheduler = createVisualScheduler({ services: { rackPulses: pulses.host } });
    // The clock reaches 500 ms, then a start is admitted for 0, well past its 20 ms interval.
    scheduler.update(1000, true);
    scheduler.update(1500, true);
    presentActivationOrder(scheduler, ["passive.1"], 0);
    scheduler.update(1510, true);
    expect(pulses.started).toEqual([]);
  });

  it("stops the pulses it started when the sequence is cancelled, and starts none after", () => {
    const pulses = host(["passive.1", "passive.2", "passive.3"]);
    const { scheduler, advance } = scheduling(pulses);
    const sequences = createActivationSequences(scheduler);
    sequences.present(["passive.1", "passive.2", "passive.3"], scheduler.nowMs / unitMs);
    advance(140);
    expect(sequences.pending).toBe(1);
    const before = pulses.started.length;
    sequences.reset();
    expect(sequences.pending).toBe(0);
    advance(600);
    // Only the ones already started, all of which were stopped; the rest never started.
    expect(pulses.started).toHaveLength(before);
    expect(pulses.stopped).toEqual(pulses.started.map(({ sourceId }) => sourceId));
  });

  it("forgets a sequence once every pulse in it has settled", () => {
    const pulses = host(["passive.1"], 100);
    const { scheduler, advance } = scheduling(pulses);
    const sequences = createActivationSequences(scheduler);
    sequences.present(["passive.1"], scheduler.nowMs / unitMs);
    expect(sequences.pending).toBe(1);
    advance(300);
    expect(sequences.pending).toBe(0);
    expect(pulses.stopped).toEqual(["passive.1"]);
  });

  it("cancels the whole sequence when its parent scope is cancelled", () => {
    const pulses = host(["passive.1", "passive.2"]);
    const { scheduler, advance } = scheduling(pulses);
    const parent = scheduler.createScope(null);
    presentActivationOrder(scheduler, ["passive.1", "passive.2"], scheduler.nowMs / unitMs, {
      parent,
    });
    advance(10);
    scheduler.cancel(parent);
    advance(600);
    expect(pulses.started.map(({ sourceId }) => sourceId)).toEqual(["passive.1"]);
  });
});

describe("the pulse handler (#540)", () => {
  it("settles at once when there is no rack to draw on", () => {
    const scheduler = createVisualScheduler({ services: {} });
    const scope = scheduler.createScope(null);
    expect(
      scheduler.schedule(scope, {
        handler: rackActivationPulse,
        payload: { sourceId: "x" },
        dueUnits: 0,
      }).accepted,
    ).toBe(true);
    scheduler.seal(scope);
    const states: string[] = [];
    scheduler.observe(scope, ({ state }) => void states.push(state));
    scheduler.update(1000, true);
    expect(states).toEqual(["finished"]);
  });

  it("starts its pulse at the scheduled time, not the frame's", () => {
    const pulses = host(["passive.1"], 450);
    const scheduler = createVisualScheduler({ services: { rackPulses: pulses.host } });
    scheduler.update(1000, true);
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, {
      handler: rackActivationPulse,
      payload: { sourceId: "passive.1" },
      dueUnits: scheduler.nowMs / unitMs + 6,
    });
    scheduler.seal(scope);
    // One late frame, 400 ms after the scheduled 400 ms start: still scheduled at that time.
    scheduler.update(1400, true);
    expect(pulses.started).toEqual([{ sourceId: "passive.1", atMs: 400 }]);
  });
});
