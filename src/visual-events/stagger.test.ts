import { describe, expect, it } from "vite-plus/test";
import { Registry } from "../core/registry";
import { createVisualScheduler, unitMs, type EffectHandle, type VisualHandler } from "./scheduler";
import {
  staggeredStartUnits,
  staggerEvents,
  staggerSpacingUnits,
  type StaggerStep,
} from "./stagger";

/**
 * A scheduler with its own handler registry and a log of when each event actually started, in
 * milliseconds of presentation time, so the tests can prove due times rather than assume them.
 */
function harness() {
  const handlers = new Registry<VisualHandler>("test handler");
  const log: { label: string; started: number }[] = [];
  handlers.register("mark", (payload, context) => {
    log.push({ label: (payload as { label: string }).label, started: context.scheduledAtMs });
    return "done";
  });
  // Runs for `ms` from its scheduled start, then finishes.
  handlers.register("effect", (payload, context) => {
    const { label, ms } = payload as { label: string; ms: number };
    log.push({ label, started: context.scheduledAtMs });
    const handle: EffectHandle = {
      update: (now) => (now - context.scheduledAtMs >= ms ? "finished" : "running"),
      cancel: () => undefined,
      dispose: () => undefined,
    };
    return handle;
  });
  return { scheduler: createVisualScheduler({ handlers }), log };
}

const labels = (log: { label: string }[]) => log.map(({ label }) => label);
const starts = (log: { label: string; started: number }[]) =>
  log.map(({ started }) => Math.round(started / unitMs));
const marks = (names: string[]): StaggerStep[] =>
  names.map((label) => ({ handler: "mark", payload: { label } }));

describe("a stagger starts its events in order, one spacing apart (#542)", () => {
  it("runs the first immediately and each later one two units after its predecessor", () => {
    const { scheduler, log } = harness();
    const admitted = staggerEvents(scheduler, null, 0, marks(["a", "b", "c"]));
    expect(admitted.accepted).toBe(true);
    // Drive the clock well past the last due time, in uneven steps, as a real frame loop does.
    for (const now of [0, 40, 150, 400, 800]) scheduler.update(now, true);
    expect(labels(log)).toEqual(["a", "b", "c"]);
    expect(starts(log)).toEqual([0, 2, 4]);
    if (admitted.accepted) expect(scheduler.status(admitted.scope).state).toBe("finished");
  });

  it("takes its spacing from configuration, and the default is the documented two units", () => {
    expect(staggerSpacingUnits).toBe(2);
    const { scheduler, log } = harness();
    staggerEvents(scheduler, null, 0, marks(["a", "b", "c"]), { spacingUnits: 5 });
    for (const now of [0, 200, 500, 900]) scheduler.update(now, true);
    expect(starts(log)).toEqual([0, 5, 10]);
  });

  it("accepts a first-event offset, defaulting to starting immediately", () => {
    const { scheduler, log } = harness();
    staggerEvents(scheduler, null, 0, marks(["a", "b"]), { firstUnits: 3 });
    for (const now of [0, 200, 400, 800]) scheduler.update(now, true);
    expect(starts(log)).toEqual([3, 5]);
  });

  it("measures from the caller's captured origin, not from the current clock", () => {
    const { scheduler, log } = harness();
    // An action that began at unit 3, bound later: its first event still belongs at unit 3.
    staggerEvents(scheduler, null, 3, marks(["a", "b"]));
    for (const now of [0, 100, 300, 600]) scheduler.update(now, true);
    expect(starts(log)).toEqual([3, 5]);
  });

  it("keeps every scheduled start when frames arrive late, rather than compressing", () => {
    const { scheduler, log } = harness();
    staggerEvents(scheduler, null, 0, marks(["a", "b", "c", "d"]));
    // The first frame only establishes the clock's baseline; then one very late frame, after which
    // every event is overdue and each still reports the time it was due.
    scheduler.update(0, true);
    scheduler.update(1000, true);
    expect(starts(log)).toEqual([0, 2, 4, 6]);
    // Exactly one start per event, never one per missed frame.
    expect(labels(log)).toEqual(["a", "b", "c", "d"]);
  });

  it("lets the sequence overlap: an effect outliving its successor's start still runs", () => {
    const { scheduler, log } = harness();
    const admitted = staggerEvents(scheduler, null, 0, [
      { handler: "effect", payload: { label: "long", ms: 500 } },
      { handler: "effect", payload: { label: "short", ms: 50 } },
    ]);
    scheduler.update(0, true);
    scheduler.update(200, true);
    // The first is still running when the second starts; the scope waits for the first.
    expect(labels(log)).toEqual(["long", "short"]);
    if (admitted.accepted) expect(scheduler.status(admitted.scope).state).toBe("pending");
    scheduler.update(600, true);
    if (admitted.accepted) expect(scheduler.status(admitted.scope).state).toBe("finished");
  });

  it("settles its own scope only after the last child has", () => {
    const { scheduler } = harness();
    const admitted = staggerEvents(scheduler, null, 0, [
      { handler: "effect", payload: { label: "a", ms: 10 } },
      { handler: "effect", payload: { label: "b", ms: 10 } },
      { handler: "effect", payload: { label: "c", ms: 100 } },
    ]);
    if (!admitted.accepted) throw new Error("expected admission");
    const { scope } = admitted;
    scheduler.update(0, true);
    scheduler.update(200, true);
    expect(scheduler.status(scope).state).toBe("pending");
    // The last child starts at unit 4 (267 ms) and runs 100 ms. A start admitted during a pass
    // settles on a later pass, so the scope finishes only once the clock runs past both.
    scheduler.update(500, true);
    expect(scheduler.status(scope).state).toBe("pending");
    scheduler.update(700, true);
    expect(scheduler.status(scope).state).toBe("finished");
  });
});

describe("a stagger owns a scope of its own (#542)", () => {
  it("returns a scope that settles without waiting for unrelated work in the parent", () => {
    const { scheduler, log } = harness();
    const action = scheduler.createScope(null);
    // Unrelated work composed into the same action scope, outliving the stagger.
    scheduler.schedule(action, {
      handler: "effect",
      payload: { label: "unrelated", ms: 5000 },
      dueUnits: 0,
    });
    const admitted = staggerEvents(scheduler, action, 0, marks(["s0", "s1"]));
    if (!admitted.accepted) throw new Error("expected admission");
    scheduler.seal(action);
    for (const now of [0, 200, 400]) scheduler.update(now, true);
    // The stagger's own scope finished, though the action scope holding it is still busy.
    expect(scheduler.status(admitted.scope).state).toBe("finished");
    expect(scheduler.status(action).state).toBe("pending");
    expect(labels(log)).toContain("unrelated");
  });

  it("cancelling it stops only its own steps, leaving the parent's other work alone", () => {
    const { scheduler, log } = harness();
    const action = scheduler.createScope(null);
    const other = scheduler.schedule(action, {
      handler: "effect",
      payload: { label: "unrelated", ms: 400 },
      dueUnits: 0,
    });
    const admitted = staggerEvents(scheduler, action, 0, marks(["s0", "s1", "s2"]));
    if (!admitted.accepted) throw new Error("expected admission");
    scheduler.seal(action);
    scheduler.update(0, true);
    expect(labels(log)).toContain("s0");
    scheduler.cancel(admitted.scope);
    for (const now of [100, 200, 400, 800]) scheduler.update(now, true);
    // The stagger's later steps never start; the unrelated effect still settles the action.
    expect(labels(log)).toEqual(["unrelated", "s0"]);
    expect(scheduler.status(admitted.scope).state).toBe("cancelled");
    expect(scheduler.status(action).state).toBe("finished");
    void other;
  });

  it("cancels with its parent when the whole action is cancelled", () => {
    const { scheduler, log } = harness();
    const action = scheduler.createScope(null);
    const admitted = staggerEvents(scheduler, action, 0, marks(["s0", "s1", "s2"]));
    if (!admitted.accepted) throw new Error("expected admission");
    scheduler.seal(action);
    scheduler.update(0, true);
    scheduler.cancel(action);
    for (const now of [100, 300, 600]) scheduler.update(now, true);
    expect(labels(log)).toEqual(["s0"]);
    expect(scheduler.status(admitted.scope).state).toBe("cancelled");
  });

  it("keeps a stagger visible through its own scope while the parent stays open", () => {
    const { scheduler } = harness();
    const action = scheduler.createScope(null);
    const admitted = staggerEvents(scheduler, action, 0, marks(["a"]));
    if (!admitted.accepted) throw new Error("expected admission");
    const seen: string[] = [];
    scheduler.observe(admitted.scope, (status) => seen.push(status.state));
    // The parent is deliberately left unsealed: observing the stagger must still settle.
    scheduler.update(0, true);
    expect(seen).toEqual(["finished"]);
  });
});

describe("a stagger is admitted whole or not at all (#542)", () => {
  it("admits nothing when the sequence cannot fit its scope's pending cap", () => {
    const { scheduler, log } = harness();
    // Room for two events, asked for three.
    const admitted = staggerEvents(scheduler, null, 0, marks(["a", "b", "c"]), {
      scope: { maxPending: 2 },
    });
    expect(admitted).toMatchObject({ accepted: false });
    for (const now of [0, 200, 400]) scheduler.update(now, true);
    // Not a half-admitted sequence: nothing ran.
    expect(log).toEqual([]);
    // Nor is an unused pending scope left behind: it was cancelled outright.
    expect(scheduler.counts.scopes).toBe(0);
    expect(scheduler.counts.pending).toBe(0);
    expect(scheduler.counts.entries).toBe(0);
  });

  it("rejects an unknown parent instead of admitting work nowhere", () => {
    const { scheduler, log } = harness();
    const foreign = createVisualScheduler().createScope(null);
    expect(staggerEvents(scheduler, foreign, 0, marks(["a"]))).toMatchObject({ accepted: false });
    scheduler.update(0, true);
    expect(log).toEqual([]);
  });

  it("rejects a non-finite or negative spacing, first offset, or origin", () => {
    const { scheduler, log } = harness();
    const steps = marks(["a"]);
    expect(staggerEvents(scheduler, null, 0, steps, { spacingUnits: -1 })).toMatchObject({
      accepted: false,
    });
    expect(
      staggerEvents(scheduler, null, 0, steps, { spacingUnits: Number.POSITIVE_INFINITY }),
    ).toMatchObject({ accepted: false });
    expect(staggerEvents(scheduler, null, 0, steps, { firstUnits: -1 })).toMatchObject({
      accepted: false,
    });
    expect(staggerEvents(scheduler, null, Number.NaN, steps)).toMatchObject({ accepted: false });
    scheduler.update(0, true);
    expect(log).toEqual([]);
  });

  it("admits an empty sequence as a scope that is already finished", () => {
    const { scheduler } = harness();
    const admitted = staggerEvents(scheduler, null, 0, []);
    if (!admitted.accepted) throw new Error("expected admission");
    scheduler.update(0, true);
    expect(scheduler.status(admitted.scope).state).toBe("finished");
  });
});

describe("repeated sequences stay independent (#542)", () => {
  it("runs two staggers side by side without one cancelling the other", () => {
    const { scheduler, log } = harness();
    const first = staggerEvents(scheduler, null, 0, marks(["x0", "x1"]));
    const second = staggerEvents(scheduler, null, 0, marks(["y0", "y1"]));
    if (!first.accepted || !second.accepted) throw new Error("expected admission");
    for (const now of [0, 100, 200, 400]) scheduler.update(now, true);
    expect(labels(log)).toEqual(["x0", "y0", "x1", "y1"]);
    expect(scheduler.status(first.scope).state).toBe("finished");
    expect(scheduler.status(second.scope).state).toBe("finished");
  });

  it("frees a stagger's work when the scheduler's generation is disposed", () => {
    const { scheduler, log } = harness();
    const admitted = staggerEvents(scheduler, null, 0, marks(["a", "b"]));
    if (!admitted.accepted) throw new Error("expected admission");
    scheduler.disposeGeneration();
    for (const now of [0, 100, 200]) scheduler.update(now, true);
    expect(log).toEqual([]);
    expect(scheduler.status(admitted.scope).state).toBe("cancelled");
  });
});

describe("the stagger's start arithmetic is exposed for callers that need it (#542)", () => {
  it("places step i at the origin plus the first offset plus i spacings", () => {
    expect(staggeredStartUnits(0, 0)).toBe(0);
    expect(staggeredStartUnits(0, 3)).toBe(6);
    expect(staggeredStartUnits(3, 2)).toBe(7);
    expect(staggeredStartUnits(0, 2, 0, 5)).toBe(10);
    expect(staggeredStartUnits(1, 2, 3)).toBe(8);
  });
});
