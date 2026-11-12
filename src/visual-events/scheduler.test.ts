import { describe, expect, it } from "vite-plus/test";
import { Registry } from "../core/registry";
import {
  createVisualScheduler,
  unitMs,
  type EffectHandle,
  type ScopeStatus,
  type VisualFallback,
  type VisualHandler,
} from "./scheduler";

/** A scheduler with its own handler and fallback registries, and a log of what ran. */
function harness(limits = {}) {
  const handlers = new Registry<VisualHandler>("test handler");
  const fallbacks = new Registry<VisualFallback>("test fallback");
  const log: string[] = [];
  const effects: { label: string; started: number; cancelled: number; disposed: number }[] = [];
  // Settles at once, recording its payload's label and when it was scheduled to start.
  handlers.register("mark", (payload, context) => {
    log.push(`${(payload as { label: string }).label}@${Math.round(context.scheduledAtMs)}`);
    return "done";
  });
  // Runs for `ms` from its scheduled start, then finishes.
  handlers.register("effect", (payload, context) => {
    const { label, ms } = payload as { label: string; ms: number };
    const record = { label, started: context.scheduledAtMs, cancelled: 0, disposed: 0 };
    effects.push(record);
    const handle: EffectHandle = {
      update: (now) => (now - context.scheduledAtMs >= ms ? "finished" : "running"),
      cancel: () => void record.cancelled++,
      dispose: () => void record.disposed++,
    };
    return handle;
  });
  // Schedules a child at the same time, recording each level.
  handlers.register("nest", (payload, context) => {
    const { level, max } = payload as { level: number; max: number };
    log.push(`nest${level}`);
    if (level < max)
      context.schedule({ handler: "nest", payload: { level: level + 1, max }, dueUnits: 0 });
    return "done";
  });
  handlers.register("throws", () => {
    throw new Error("boom");
  });
  const scheduler = createVisualScheduler({
    handlers,
    fallbacks,
    limits,
    services: { probe: true },
  });
  return { scheduler, handlers, fallbacks, log, effects };
}

describe("the visual-event scheduler (#546)", () => {
  it("starts due events in (due time, insertion) order, ties by insertion", () => {
    const { scheduler, log } = harness();
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, { handler: "mark", payload: { label: "b" }, dueUnits: 2 });
    scheduler.schedule(scope, { handler: "mark", payload: { label: "a1" }, dueUnits: 1 });
    scheduler.schedule(scope, { handler: "mark", payload: { label: "a2" }, dueUnits: 1 });
    scheduler.update(0, true);
    scheduler.update(1000, true);
    expect(log).toEqual([
      `a1@${Math.round(unitMs)}`,
      `a2@${Math.round(unitMs)}`,
      `b@${Math.round(2 * unitMs)}`,
    ]);
  });

  it("starts an immediate first event on the next update", () => {
    const { scheduler, log } = harness();
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, { handler: "mark", payload: { label: "now" }, dueUnits: 0 });
    scheduler.update(5, true);
    expect(log).toEqual(["now@0"]);
  });

  it("starts each event once after a long late frame, each at its scheduled time", () => {
    const { scheduler, log } = harness();
    const scope = scheduler.createScope(null);
    for (const units of [1, 2, 3])
      scheduler.schedule(scope, {
        handler: "mark",
        payload: { label: `u${units}` },
        dueUnits: units,
      });
    scheduler.update(0, true);
    scheduler.update(5000, true);
    scheduler.update(6000, true);
    expect(log).toEqual([1, 2, 3].map((units) => `u${units}@${Math.round(units * unitMs)}`));
  });

  it("runs same-time nested children within the same pass, refusing depth 33", () => {
    const { scheduler, log } = harness();
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, { handler: "nest", payload: { level: 1, max: 40 }, dueUnits: 0 });
    scheduler.update(0, true);
    // Depth 32 admits; the 33rd level is refused, so the chain stops at 32.
    expect(log.length).toBe(32);
    expect(log.at(-1)).toBe("nest32");
  });

  it("settles a sealed scope only when its effects finish, after the queue is empty", () => {
    const { scheduler, effects } = harness();
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, {
      handler: "effect",
      payload: { label: "long", ms: 500 },
      dueUnits: 0,
    });
    scheduler.seal(scope);
    scheduler.update(0, true);
    expect(scheduler.counts.heap).toBe(0);
    expect(scheduler.status(scope).state).toBe("pending");
    scheduler.update(400, true);
    expect(scheduler.status(scope).state).toBe("pending");
    scheduler.update(600, true);
    expect(scheduler.status(scope)).toEqual({ state: "finished" });
    expect(effects[0]).toMatchObject({ disposed: 1, cancelled: 0 });
  });

  it("composes a sequence, a parallel group and a stagger from scopes and due times", () => {
    const { scheduler, log } = harness();
    // Parallel: one scope, two effects; it settles when both have.
    const parallel = scheduler.createScope(null);
    scheduler.schedule(parallel, {
      handler: "effect",
      payload: { label: "p1", ms: 100 },
      dueUnits: 0,
    });
    scheduler.schedule(parallel, {
      handler: "effect",
      payload: { label: "p2", ms: 300 },
      dueUnits: 0,
    });
    scheduler.seal(parallel);
    // Sequence: the next step starts when the previous scope settles.
    const next = scheduler.createScope(null);
    scheduler.observe(parallel, () => {
      scheduler.schedule(next, { handler: "mark", payload: { label: "after" }, dueUnits: 0 });
      scheduler.seal(next);
    });
    // Stagger: fixed offsets, not waiting for one another.
    const stagger = scheduler.createScope(null);
    for (const i of [0, 1, 2])
      scheduler.schedule(stagger, {
        handler: "mark",
        payload: { label: `s${i}` },
        dueUnits: i * 2,
      });
    scheduler.seal(stagger);
    scheduler.update(0, true);
    scheduler.update(200, true);
    expect(scheduler.status(parallel).state).toBe("pending");
    scheduler.update(350, true);
    scheduler.update(360, true);
    expect(scheduler.status(parallel).state).toBe("finished");
    expect(log.filter((entry) => entry.startsWith("s"))).toEqual(["s0@0", "s1@133", "s2@267"]);
    expect(log).toContain("after@0");
    expect(scheduler.status(next).state).toBe("finished");
  });

  it("cancels before and during effects, cascading to children once", () => {
    const { scheduler, effects, log } = harness();
    const parent = scheduler.createScope(null);
    const child = scheduler.createScope(parent);
    scheduler.schedule(child, {
      handler: "effect",
      payload: { label: "running", ms: 1000 },
      dueUnits: 0,
    });
    scheduler.schedule(child, { handler: "mark", payload: { label: "never" }, dueUnits: 30 });
    scheduler.seal(child);
    scheduler.seal(parent);
    scheduler.update(0, true);
    const seen: ScopeStatus[] = [];
    scheduler.observe(child, (status) => seen.push(status));
    scheduler.cancel(parent);
    scheduler.cancel(parent);
    scheduler.update(5000, true);
    expect(log).toEqual([]);
    expect(effects[0]).toMatchObject({ cancelled: 1, disposed: 1 });
    expect(seen).toEqual([{ state: "cancelled" }]);
    expect(scheduler.status(parent).state).toBe("cancelled");
    expect(scheduler.counts).toMatchObject({ pending: 0, active: 0, heap: 0, entries: 0 });
  });

  it("drops a whole generation: its scopes cancel and later work from it is refused", () => {
    const { scheduler, effects } = harness();
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, {
      handler: "effect",
      payload: { label: "old", ms: 1000 },
      dueUnits: 0,
    });
    scheduler.update(0, true);
    scheduler.disposeGeneration();
    expect(effects[0]).toMatchObject({ cancelled: 1, disposed: 1 });
    expect(
      scheduler.schedule(scope, { handler: "mark", payload: { label: "x" }, dueUnits: 0 }).accepted,
    ).toBe(false);
    expect(scheduler.counts).toMatchObject({ pending: 0, active: 0, entries: 0, scopes: 0 });
  });

  it("enforces the bounds without changing any count on refusal", () => {
    const { scheduler } = harness();
    const scopes = [0, 1, 2, 3].map(() => scheduler.createScope(null));
    for (const scope of scopes)
      for (let i = 0; i < 1024; i++)
        scheduler.schedule(scope, { handler: "mark", payload: { label: "x" }, dueUnits: 0 });
    expect(scheduler.counts.pending).toBe(4096);
    const extra = scheduler.createScope(null);
    expect(
      scheduler.schedule(extra, { handler: "mark", payload: { label: "x" }, dueUnits: 0 }),
    ).toEqual({
      accepted: false,
      reason: "global pending limit",
    });
    expect(scheduler.counts.pending).toBe(4096);
    // 128 starts per update: 32 updates drain the backlog.
    let updates = 0;
    while (scheduler.counts.pending > 0) scheduler.update(updates++, true);
    expect(updates).toBe(32);
  });

  it("caps a scope at 1024 and admits a batch all or nothing", () => {
    const { scheduler } = harness();
    const scope = scheduler.createScope(null);
    const batch = Array.from({ length: 1025 }, () => ({
      handler: "mark",
      payload: { label: "x" },
      dueUnits: 0,
    }));
    expect(scheduler.scheduleBatch(scope, batch).accepted).toBe(false);
    expect(scheduler.counts.pending).toBe(0);
    // A batch whose last entry is invalid admits none of it.
    const bad = [...batch.slice(0, 3), { handler: "nope", dueUnits: 0 }];
    expect(scheduler.scheduleBatch(scope, bad).accepted).toBe(false);
    expect(scheduler.counts).toMatchObject({ pending: 0, heap: 0, entries: 0 });
    expect(scheduler.scheduleBatch(scope, batch.slice(0, 1024)).accepted).toBe(true);
    expect(scheduler.schedule(scope, batch[0]!).accepted).toBe(false);
  });

  it("holds starts at the active cap until effects finish", () => {
    const { scheduler } = harness({ activeGlobal: 2 });
    const scope = scheduler.createScope(null);
    for (let i = 0; i < 3; i++)
      scheduler.schedule(scope, {
        handler: "effect",
        payload: { label: `e${i}`, ms: 100 },
        dueUnits: 0,
      });
    scheduler.update(0, true);
    expect(scheduler.counts).toMatchObject({ active: 2, pending: 1 });
    // The first two finish; the third starts in the freed slot, at its scheduled time (0), so it
    // is already overdue and finishes on the next update.
    scheduler.update(150, true);
    expect(scheduler.counts).toMatchObject({ active: 1, pending: 0 });
    scheduler.update(151, true);
    expect(scheduler.counts.active).toBe(0);
  });

  it("fails an effect past its time, cancels it and runs the producer's fallback once", () => {
    const { scheduler, fallbacks, effects } = harness();
    const reasons: string[] = [];
    fallbacks.register("summary", ({ reason }) => void reasons.push(reason));
    const scope = scheduler.createScope(null, { maxEffectMs: 200, fallback: "summary" });
    scheduler.schedule(scope, {
      handler: "effect",
      payload: { label: "stuck", ms: 99_999 },
      dueUnits: 0,
    });
    scheduler.seal(scope);
    scheduler.update(0, true);
    scheduler.update(300, true);
    scheduler.update(400, true);
    expect(effects[0]).toMatchObject({ cancelled: 1, disposed: 1 });
    expect(reasons).toHaveLength(1);
    expect(scheduler.status(scope).state).toBe("failed");
  });

  it("settles failed, never hanging, when the fallback itself fails or a handler throws", () => {
    const { scheduler, fallbacks } = harness();
    fallbacks.register("broken", () => {
      throw new Error("sink down");
    });
    const scope = scheduler.createScope(null, { fallback: "broken" });
    scheduler.schedule(scope, { handler: "throws", dueUnits: 0 });
    scheduler.seal(scope);
    scheduler.update(0, true);
    expect(scheduler.status(scope)).toEqual({
      state: "failed",
      diagnostic: 'handler "throws" failed: boom',
    });
  });

  it("excludes hidden time: the clock rebases on the next visible frame", () => {
    const { scheduler, log } = harness();
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, { handler: "mark", payload: { label: "later" }, dueUnits: 15 });
    scheduler.update(0, true);
    scheduler.update(500, true);
    scheduler.update(600, false);
    scheduler.update(60_000, false);
    scheduler.update(60_100, true);
    expect(scheduler.nowMs).toBe(500);
    expect(log).toEqual([]);
    scheduler.update(60_700, true);
    expect(log).toEqual(["later@1000"]);
  });

  it("refuses invalid times, unknown handlers and live objects in payloads", () => {
    const { scheduler } = harness();
    const scope = scheduler.createScope(null);
    const refused = (description: Parameters<typeof scheduler.schedule>[1]) =>
      scheduler.schedule(scope, description).accepted;
    expect(refused({ handler: "mark", dueUnits: -1 })).toBe(false);
    expect(refused({ handler: "mark", dueUnits: Number.NaN })).toBe(false);
    expect(refused({ handler: "nope", dueUnits: 0 })).toBe(false);
    expect(refused({ handler: "mark", payload: { live: new Map() }, dueUnits: 0 })).toBe(false);
    expect(refused({ handler: "mark", payload: { callback: () => 1 }, dueUnits: 0 })).toBe(false);
    expect(scheduler.counts.pending).toBe(0);
  });

  it("freezes a captured payload, so a later change to the source never reaches the effect", () => {
    const { scheduler, handlers } = harness();
    const seen: unknown[] = [];
    handlers.register("capture", (payload) => {
      seen.push(payload);
      return "done";
    });
    const source = { lines: [1, 2] };
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, { handler: "capture", payload: source, dueUnits: 0 });
    source.lines.push(3);
    scheduler.update(0, true);
    expect(seen).toEqual([{ lines: [1, 2] }]);
    expect(Object.isFrozen((seen[0] as { lines: number[] }).lines)).toBe(true);
  });

  it("refuses work after sealing, except a running handler's own children", () => {
    const { scheduler, log } = harness();
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, { handler: "nest", payload: { level: 1, max: 2 }, dueUnits: 0 });
    scheduler.seal(scope);
    expect(
      scheduler.schedule(scope, { handler: "mark", payload: { label: "late" }, dueUnits: 0 })
        .accepted,
    ).toBe(false);
    scheduler.update(0, true);
    expect(log).toEqual(["nest1", "nest2"]);
    expect(scheduler.status(scope).state).toBe("finished");
    expect(scheduler.seal(scope)).toBe(false);
  });

  it("reports an already settled scope to a late observer once", () => {
    const { scheduler } = harness();
    const scope = scheduler.createScope(null);
    scheduler.seal(scope);
    const seen: ScopeStatus[] = [];
    scheduler.observe(scope, (status) => seen.push(status));
    expect(seen).toEqual([{ state: "finished" }]);
  });

  it("gives handlers no model, mutation or random stream, and refuses a re-entrant update", () => {
    const { scheduler, handlers } = harness();
    const keys: string[][] = [];
    let reentry: unknown = null;
    handlers.register("inspect", (_payload, context) => {
      keys.push(Object.keys(context).sort());
      try {
        scheduler.update(1, true);
      } catch (error) {
        reentry = error;
      }
      return "done";
    });
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, { handler: "inspect", dueUnits: 0 });
    scheduler.update(0, true);
    expect(keys[0]).toEqual(["cancel", "nowMs", "schedule", "scheduledAtMs", "scope", "services"]);
    expect(reentry).toBeInstanceOf(Error);
  });

  it("dispatches a newly registered handler without any change to the scheduler", () => {
    const { scheduler, handlers } = harness();
    let ran = false;
    handlers.register("brand-new", () => {
      ran = true;
      return "done";
    });
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, { handler: "brand-new", dueUnits: 0 });
    scheduler.update(0, true);
    expect(ran).toBe(true);
  });

  it("keeps two quick plays' feedback apart: the second runs while the first's stagger is still going", () => {
    const { scheduler, log } = harness();
    const play1 = scheduler.createScope(null);
    for (const i of [0, 1, 2, 3])
      scheduler.schedule(play1, {
        handler: "mark",
        payload: { label: `one${i}` },
        dueUnits: i * 2,
      });
    scheduler.seal(play1);
    scheduler.update(0, true);
    // Play 2 commits 100 ms later, mid-stagger; its own feedback starts at once.
    scheduler.update(100, true);
    const play2 = scheduler.createScope(null);
    scheduler.schedule(play2, {
      handler: "mark",
      payload: { label: "two0" },
      dueUnits: 100 / unitMs,
    });
    scheduler.seal(play2);
    for (const t of [101, 200, 300, 400, 600]) scheduler.update(t, true);
    expect(log).toEqual(["one0@0", "two0@100", "one1@133", "one2@267", "one3@400"]);
    expect(scheduler.status(play1).state).toBe("finished");
    expect(scheduler.status(play2).state).toBe("finished");
  });

  it("reports a cancelled parent as cancelled once, never finished first (#785 review)", () => {
    const { scheduler } = harness();
    const parent = scheduler.createScope(null);
    const child = scheduler.createScope(parent);
    scheduler.schedule(child, {
      handler: "effect",
      payload: { label: "x", ms: 1000 },
      dueUnits: 0,
    });
    scheduler.seal(child);
    scheduler.seal(parent);
    scheduler.update(0, true);
    const seen: ScopeStatus[] = [];
    scheduler.observe(parent, (status) => seen.push(status));
    scheduler.cancel(parent);
    expect(seen).toEqual([{ state: "cancelled" }]);
  });

  it("releases an effect returned after its handler cancelled its own scope (#785 review)", () => {
    const { scheduler, handlers } = harness();
    const released: string[] = [];
    handlers.register("self-cancel", (_payload, context) => {
      context.cancel(context.scope);
      return {
        update: () => "running",
        cancel: () => void released.push("cancel"),
        dispose: () => void released.push("dispose"),
      };
    });
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, { handler: "self-cancel", dueUnits: 0 });
    scheduler.update(0, true);
    scheduler.disposeGeneration();
    expect(released).toEqual(["cancel", "dispose"]);
    expect(scheduler.counts).toMatchObject({ active: 0, entries: 0 });
  });

  it("gives a stale parent from a disposed generation a cancelled scope, not a new root (#785 review)", () => {
    const { scheduler } = harness();
    const oldScene = scheduler.createScope(null);
    scheduler.disposeGeneration();
    const late = scheduler.createScope(oldScene);
    expect(scheduler.status(late).state).toBe("cancelled");
    expect(
      scheduler.schedule(late, { handler: "mark", payload: { label: "old" }, dueUnits: 0 })
        .accepted,
    ).toBe(false);
  });

  it("refuses scope overrides that would disable the bounds (#785 review)", () => {
    const { scheduler } = harness();
    for (const config of [
      { maxEffectMs: Number.NaN },
      { maxEffectMs: Infinity },
      { maxEffectMs: 0 },
      { maxPending: 1.5 },
      { maxPending: 0 },
    ])
      expect(() => scheduler.createScope(null, config)).toThrow();
  });

  it("refuses a child scope created while its parent is cancelling (#785 review)", () => {
    const { scheduler } = harness();
    const parent = scheduler.createScope(null);
    const child = scheduler.createScope(parent);
    let late: ReturnType<typeof scheduler.createScope> | null = null;
    scheduler.observe(child, () => {
      late = scheduler.createScope(parent);
    });
    scheduler.cancel(parent);
    expect(scheduler.status(late!).state).toBe("cancelled");
  });

  it("releases settled entries from a long-lived scope (#785 review)", () => {
    const { scheduler } = harness();
    const scope = scheduler.createScope(null);
    for (let i = 0; i < 100; i++) {
      scheduler.schedule(scope, { handler: "mark", payload: { label: "x" }, dueUnits: 0 });
      scheduler.update(i, true);
    }
    expect(scheduler.counts.entries).toBe(0);
    let rescanned = 0;
    scheduler.observe(scope, () => rescanned++);
    scheduler.cancel(scope);
    expect(rescanned).toBe(1);
  });

  it("isolates a throwing effect update: its scope fails, others keep running (#785 review)", () => {
    const { scheduler, handlers, log } = harness();
    let disposed = 0;
    handlers.register("bad", () => ({
      update: () => {
        throw new Error("bad frame");
      },
      cancel: () => {},
      dispose: () => void disposed++,
    }));
    const broken = scheduler.createScope(null);
    scheduler.schedule(broken, { handler: "bad", dueUnits: 0 });
    scheduler.seal(broken);
    const other = scheduler.createScope(null);
    scheduler.schedule(other, { handler: "mark", payload: { label: "ok" }, dueUnits: 1 });
    scheduler.update(0, true);
    scheduler.update(100, true);
    expect(scheduler.status(broken).state).toBe("failed");
    expect(disposed).toBe(1);
    expect(log).toContain("ok@67");
  });

  it("cancels an effect once even when its cancel re-enters cancellation (#785 review)", () => {
    const { scheduler, handlers } = harness();
    let cancels = 0;
    handlers.register("reenter", (_payload, context) => ({
      update: () => "running",
      cancel: () => {
        cancels++;
        context.cancel(context.scope);
      },
      dispose: () => {},
    }));
    const scope = scheduler.createScope(null);
    const admitted = scheduler.schedule(scope, { handler: "reenter", dueUnits: 0 });
    scheduler.update(0, true);
    if (admitted.accepted) scheduler.cancel(admitted.handle);
    expect(cancels).toBe(1);
    expect(scheduler.counts.active).toBe(0);
  });

  it("still settles the parent when a child's observer throws (#785 review)", async () => {
    const { scheduler } = harness();
    const parent = scheduler.createScope(null);
    const child = scheduler.createScope(parent);
    scheduler.seal(parent);
    scheduler.observe(child, () => {
      throw new Error("observer");
    });
    const errors: unknown[] = [];
    const original = globalThis.queueMicrotask;
    globalThis.queueMicrotask = (task) => {
      try {
        task();
      } catch (error) {
        errors.push(error);
      }
    };
    try {
      scheduler.seal(child);
    } finally {
      globalThis.queueMicrotask = original;
    }
    expect(scheduler.status(parent).state).toBe("finished");
    expect(errors).toHaveLength(1);
  });

  it("refuses new work in a scope that is cancelling (#785 review)", () => {
    const { scheduler, handlers, log } = harness();
    handlers.register("sneaky", (_payload, context) => ({
      update: () => "running",
      cancel: () => {
        scheduler.schedule(context.scope, {
          handler: "mark",
          payload: { label: "escaped" },
          dueUnits: 0,
        });
      },
      dispose: () => {},
    }));
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, { handler: "sneaky", dueUnits: 0 });
    scheduler.update(0, true);
    scheduler.cancel(scope);
    scheduler.update(100, true);
    expect(log).toEqual([]);
    expect(scheduler.counts).toMatchObject({ pending: 0, active: 0, entries: 0 });
  });

  it("finishes cancelling when an effect's cleanup throws (#785 review)", () => {
    const { scheduler, handlers } = harness();
    let disposed = 0;
    handlers.register("brittle", () => ({
      update: () => "running",
      cancel: () => {
        throw new Error("cancel");
      },
      dispose: () => void disposed++,
    }));
    const original = globalThis.queueMicrotask;
    const errors: unknown[] = [];
    globalThis.queueMicrotask = (task) => {
      try {
        task();
      } catch (error) {
        errors.push(error);
      }
    };
    try {
      const scope = scheduler.createScope(null);
      scheduler.schedule(scope, { handler: "brittle", dueUnits: 0 });
      scheduler.seal(scope);
      scheduler.update(0, true);
      scheduler.cancel(scope);
      expect(scheduler.status(scope).state).toBe("cancelled");
    } finally {
      globalThis.queueMicrotask = original;
    }
    expect(disposed).toBe(1);
    expect(errors).toHaveLength(1);
    expect(scheduler.counts).toMatchObject({ active: 0, entries: 0 });
  });
});
