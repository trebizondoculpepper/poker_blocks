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

describe("a stagger starts its events in order, one spacing apart (#542)", () => {
  it("runs the first immediately and each later one two units after its predecessor", () => {
    const { scheduler, log } = harness();
    const scope = scheduler.createScope(null);
    const admitted = staggerEvents(scheduler, scope, 0, [
      { handler: "mark", payload: { label: "a" } },
      { handler: "mark", payload: { label: "b" } },
      { handler: "mark", payload: { label: "c" } },
    ]);
    expect(admitted.accepted).toBe(true);
    scheduler.seal(scope);
    // Drive the clock well past the last due time, in uneven steps, as a real frame loop does.
    for (const now of [0, 40, 150, 400, 800]) scheduler.update(now, true);
    expect(labels(log)).toEqual(["a", "b", "c"]);
    expect(starts(log)).toEqual([0, 2, 4]);
    expect(scheduler.status(scope).state).toBe("finished");
  });

  it("takes its spacing from configuration, and the default is the documented two units", () => {
    expect(staggerSpacingUnits).toBe(2);
    const { scheduler, log } = harness();
    const scope = scheduler.createScope(null);
    staggerEvents(
      scheduler,
      scope,
      0,
      [
        { handler: "mark", payload: { label: "a" } },
        { handler: "mark", payload: { label: "b" } },
        { handler: "mark", payload: { label: "c" } },
      ],
      { spacingUnits: 5 },
    );
    scheduler.seal(scope);
    for (const now of [0, 200, 500, 900]) scheduler.update(now, true);
    expect(starts(log)).toEqual([0, 5, 10]);
  });

  it("measures from the caller's captured origin, not from the current clock", () => {
    const { scheduler, log } = harness();
    const scope = scheduler.createScope(null);
    // An action that began at unit 3, bound later: its first event still belongs at unit 3.
    staggerEvents(scheduler, scope, 3, [
      { handler: "mark", payload: { label: "a" } },
      { handler: "mark", payload: { label: "b" } },
    ]);
    scheduler.seal(scope);
    for (const now of [0, 100, 300, 600]) scheduler.update(now, true);
    expect(starts(log)).toEqual([3, 5]);
  });

  it("keeps every scheduled start when frames arrive late, rather than compressing", () => {
    const { scheduler, log } = harness();
    const scope = scheduler.createScope(null);
    staggerEvents(scheduler, scope, 0, [
      { handler: "mark", payload: { label: "a" } },
      { handler: "mark", payload: { label: "b" } },
      { handler: "mark", payload: { label: "c" } },
      { handler: "mark", payload: { label: "d" } },
    ]);
    scheduler.seal(scope);
    // The first frame only establishes the clock's baseline; then one very late frame, after which
    // every event is overdue and each still reports the time it was due.
    scheduler.update(0, true);
    scheduler.update(1000, true);
    expect(starts(log)).toEqual([0, 2, 4, 6]);
    // A single start sound per event, never one per missed frame.
    expect(labels(log)).toEqual(["a", "b", "c", "d"]);
  });

  it("lets the sequence overlap: an effect outliving its successor's start still runs", () => {
    const { scheduler, log } = harness();
    const scope = scheduler.createScope(null);
    staggerEvents(scheduler, scope, 0, [
      { handler: "effect", payload: { label: "long", ms: 500 } },
      { handler: "effect", payload: { label: "short", ms: 50 } },
    ]);
    scheduler.seal(scope);
    scheduler.update(0, true);
    scheduler.update(200, true);
    // The first is still running when the second starts; the scope waits for the first.
    expect(labels(log)).toEqual(["long", "short"]);
    expect(scheduler.status(scope).state).toBe("pending");
    scheduler.update(600, true);
    expect(scheduler.status(scope).state).toBe("finished");
  });

  it("settles its owning scope only after the last child has", () => {
    const { scheduler } = harness();
    const scope = scheduler.createScope(null);
    staggerEvents(scheduler, scope, 0, [
      { handler: "effect", payload: { label: "a", ms: 10 } },
      { handler: "effect", payload: { label: "b", ms: 10 } },
      { handler: "effect", payload: { label: "c", ms: 100 } },
    ]);
    scheduler.seal(scope);
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

describe("a stagger is admitted whole or not at all (#542)", () => {
  it("admits nothing when the sequence cannot fit the scope's pending cap", () => {
    const { scheduler, log } = harness();
    // Room for two events, asked for three.
    const scope = scheduler.createScope(null, { maxPending: 2 });
    const admitted = staggerEvents(scheduler, scope, 0, [
      { handler: "mark", payload: { label: "a" } },
      { handler: "mark", payload: { label: "b" } },
      { handler: "mark", payload: { label: "c" } },
    ]);
    expect(admitted).toMatchObject({ accepted: false });
    scheduler.seal(scope);
    for (const now of [0, 200, 400]) scheduler.update(now, true);
    // Not a half-admitted sequence: nothing ran, and the scope settled clean.
    expect(log).toEqual([]);
    expect(scheduler.status(scope).state).toBe("finished");
  });

  it("rejects an unknown scope instead of admitting work nowhere", () => {
    const { scheduler, log } = harness();
    const other = createVisualScheduler();
    const foreign = other.createScope(null);
    expect(
      staggerEvents(scheduler, foreign, 0, [{ handler: "mark", payload: { label: "a" } }]),
    ).toMatchObject({ accepted: false });
    scheduler.update(0, true);
    expect(log).toEqual([]);
  });

  it("rejects a non-finite or negative spacing, and a non-finite origin", () => {
    const { scheduler, log } = harness();
    const scope = scheduler.createScope(null);
    const steps: StaggerStep[] = [{ handler: "mark", payload: { label: "a" } }];
    expect(staggerEvents(scheduler, scope, 0, steps, { spacingUnits: -1 })).toMatchObject({
      accepted: false,
    });
    expect(
      staggerEvents(scheduler, scope, 0, steps, { spacingUnits: Number.POSITIVE_INFINITY }),
    ).toMatchObject({ accepted: false });
    expect(staggerEvents(scheduler, scope, Number.NaN, steps)).toMatchObject({ accepted: false });
    scheduler.update(0, true);
    expect(log).toEqual([]);
  });

  it("admits an empty sequence as nothing to do", () => {
    const { scheduler } = harness();
    const scope = scheduler.createScope(null);
    expect(staggerEvents(scheduler, scope, 0, [])).toMatchObject({ accepted: true, handles: [] });
    scheduler.seal(scope);
    scheduler.update(0, true);
    expect(scheduler.status(scope).state).toBe("finished");
  });
});

describe("a stagger cancels and disposes with the scope that owns it (#542)", () => {
  it("stops the remaining events when its scope is cancelled partway through", () => {
    const { scheduler, log } = harness();
    const scope = scheduler.createScope(null);
    staggerEvents(scheduler, scope, 0, [
      { handler: "mark", payload: { label: "a" } },
      { handler: "mark", payload: { label: "b" } },
      { handler: "mark", payload: { label: "c" } },
    ]);
    scheduler.seal(scope);
    scheduler.update(0, true);
    expect(labels(log)).toEqual(["a"]);
    scheduler.cancel(scope);
    for (const now of [100, 200, 400, 800]) scheduler.update(now, true);
    // The two later events never start, and the scope reports cancelled exactly once.
    expect(labels(log)).toEqual(["a"]);
    expect(scheduler.status(scope).state).toBe("cancelled");
  });

  it("can hold repeated sequences side by side without one cancelling the other", () => {
    const { scheduler, log } = harness();
    const first = scheduler.createScope(null);
    const second = scheduler.createScope(null);
    for (const [scope, name] of [
      [first, "x"],
      [second, "y"],
    ] as const) {
      staggerEvents(scheduler, scope, 0, [
        { handler: "mark", payload: { label: `${name}0` } },
        { handler: "mark", payload: { label: `${name}1` } },
      ]);
      scheduler.seal(scope);
    }
    for (const now of [0, 100, 200, 400]) scheduler.update(now, true);
    expect(labels(log)).toEqual(["x0", "y0", "x1", "y1"]);
    expect(scheduler.status(first).state).toBe("finished");
    expect(scheduler.status(second).state).toBe("finished");
  });

  it("frees a cancelled scope's work when the scheduler's generation is disposed", () => {
    const { scheduler, log } = harness();
    const scope = scheduler.createScope(null);
    staggerEvents(scheduler, scope, 0, [
      { handler: "mark", payload: { label: "a" } },
      { handler: "mark", payload: { label: "b" } },
    ]);
    scheduler.seal(scope);
    scheduler.disposeGeneration();
    for (const now of [0, 100, 200]) scheduler.update(now, true);
    expect(log).toEqual([]);
    expect(scheduler.status(scope).state).toBe("cancelled");
  });
});

describe("the stagger's start arithmetic is exposed for callers that need it (#542)", () => {
  it("places step i at the origin plus i spacings, defaulting to the documented spacing", () => {
    expect(staggeredStartUnits(0, 0)).toBe(0);
    expect(staggeredStartUnits(0, 3)).toBe(6);
    expect(staggeredStartUnits(3, 2)).toBe(7);
    expect(staggeredStartUnits(0, 2, 5)).toBe(10);
  });
});
