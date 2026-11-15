import { describe, expect, it, vi } from "vite-plus/test";
import { Registry } from "../core/registry";
import {
  createMountRegistry,
  guardMountEffect,
  mountProjections,
  type MountHandle,
} from "./mount-registry";
import { createVisualScheduler, type EffectHandle, type VisualHandler } from "./scheduler";

type Pose = { x: number };
type Look = { material: string };

/** A finite effect that runs for `ms`, recording its lifecycle. */
function recordingEffect(ms: number) {
  const log: string[] = [];
  let started: number | null = null;
  const effect: EffectHandle = {
    update(now) {
      started ??= now;
      log.push("update");
      return now - started >= ms ? "finished" : "running";
    },
    cancel: () => void log.push("cancel"),
    dispose: () => void log.push("dispose"),
  };
  return { effect, log };
}

describe("presentation mount registry (#1163; doc/visual-event-interface.md, #1161)", () => {
  it("resolves fresh handles only, never an old handle to a new object in the same place", () => {
    const mounts = createMountRegistry<Pose, Look>();
    const first = mounts.create({ x: 1 }, { material: "steel" });
    mounts.remove(first);
    const second = mounts.create({ x: 1 }, { material: "steel" });
    expect(mounts.resolve(first)).toBeNull();
    expect(mounts.resolve(second)?.pose).toEqual({ x: 1 });
  });

  it("keeps pose and appearance channels independent", () => {
    const mounts = createMountRegistry<Pose, Look>();
    const handle = mounts.create({ x: 0 }, { material: "steel" });
    const pose = vi.fn();
    const look = vi.fn();
    const poseLease = mounts.acquire(handle, "pose", pose)!;
    const lookLease = mounts.acquire(handle, "appearance", look)!;
    mounts.replaceAppearance(handle, { material: "gold" });
    // The block keeps moving; only appearance-bound effects are invalidated.
    expect(poseLease.valid).toBe(true);
    expect(lookLease.valid).toBe(false);
    expect(look).toHaveBeenCalledTimes(1);
    expect(mounts.resolve(handle)).toMatchObject({
      appearance: { material: "gold" },
      revisions: { pose: 1, appearance: 2 },
    });
    // A stale appearance revision is never silently rebound.
    expect(mounts.acquire(handle, "appearance", undefined, 1)).toBeNull();
    mounts.remove(handle);
    expect(poseLease.valid).toBe(false);
    expect(pose).toHaveBeenCalledTimes(1);
    expect(look).toHaveBeenCalledTimes(1);
  });

  it("ends a generation: every handle stale and every lease invalidated once", () => {
    const mounts = createMountRegistry<Pose, Look>();
    const handle = mounts.create({ x: 0 }, { material: "steel" });
    const invalidated = vi.fn();
    mounts.acquire(handle, "pose", invalidated);
    mounts.resetGeneration();
    mounts.resetGeneration();
    expect(mounts.resolve(handle)).toBeNull();
    expect(invalidated).toHaveBeenCalledTimes(1);
  });

  it("retains a captured snapshot past removal, without live membership, released once", () => {
    const mounts = createMountRegistry<Pose, Look>();
    const handle = mounts.create({ x: 2 }, { material: "glass" });
    const dispose = vi.fn();
    const snapshot = mounts.snapshot(handle, ({ appearance }) => ({ ...appearance }), dispose)!;
    mounts.remove(handle);
    expect(snapshot.captured).toEqual({ material: "glass" });
    expect(mounts.resolve(handle)).toBeNull();
    snapshot.release();
    snapshot.release();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("applies committed projection updates through registered handlers, refusing stale ones", () => {
    const applied: unknown[] = [];
    mountProjections.register("test.recolour", (payload, context, target) => {
      applied.push(payload);
      context.replaceAppearance(target!, payload);
    });
    const mounts = createMountRegistry<Pose, Look>();
    const handle = mounts.create({ x: 0 }, { material: "steel" });
    expect(
      mounts.publish(
        { handler: "test.recolour", correlation: 2, payload: { material: "gold" } },
        handle,
      ),
    ).toBe(true);
    // An older committed revision arriving late never undoes the newer appearance.
    expect(
      mounts.publish(
        { handler: "test.recolour", correlation: 1, payload: { material: "tin" } },
        handle,
      ),
    ).toBe(false);
    expect(mounts.resolve(handle)?.appearance).toEqual({ material: "gold" });
    expect(applied).toEqual([{ material: "gold" }]);
    mounts.remove(handle);
    expect(mounts.publish({ handler: "test.recolour", correlation: 3, payload: {} }, handle)).toBe(
      false,
    );
  });
});

describe("mount registry follow-ups (#1181)", () => {
  it("starts a mount at the correlation of the update that created it", () => {
    let made: MountHandle | null = null;
    mountProjections.register("test.create", (_payload, context) => {
      made = context.create({ x: 0 }, { material: "steel" });
    });
    mountProjections.register("test.touch", () => {});
    const mounts = createMountRegistry<Pose, Look>();
    mounts.publish({ handler: "test.create", correlation: 5, payload: null });
    // An older committed update arriving late is refused.
    expect(mounts.publish({ handler: "test.touch", correlation: 4, payload: null }, made!)).toBe(
      false,
    );
    expect(mounts.publish({ handler: "test.touch", correlation: 6, payload: null }, made!)).toBe(
      true,
    );
    // Outside a publish, a mount starts from zero.
    const direct = mounts.create({ x: 1 }, { material: "tin" });
    expect(mounts.publish({ handler: "test.touch", correlation: 1, payload: null }, direct)).toBe(
      true,
    );
  });

  it("releases its lease and snapshot when the effect cannot be built", () => {
    const mounts = createMountRegistry<Pose, Look>();
    const handle = mounts.create({ x: 0 }, { material: "steel" });
    const released = vi.fn();
    const snapshot = mounts.snapshot(handle, (m) => m.appearance, released);
    expect(() =>
      guardMountEffect(mounts, {
        handle,
        channel: "appearance",
        revision: 1,
        policy: "omit",
        captured: null,
        snapshot,
        services: null,
        start: () => {
          throw new Error("no resources");
        },
      }),
    ).toThrow("no resources");
    expect(released).toHaveBeenCalledTimes(1);
    // The lease is gone: a replacement notifies no one, and a fresh lease can be taken.
    expect(mounts.acquire(handle, "appearance")).not.toBeNull();
  });
});

describe("missing-mount policies on the shared scheduler (#1163)", () => {
  /** A scheduler with one handler that runs a guarded effect, on an injected clock. */
  function harness(policy: string, services: unknown = {}) {
    const mounts = createMountRegistry<Pose, Look>();
    const handlers = new Registry<VisualHandler>("test handler");
    const effects: ReturnType<typeof recordingEffect>[] = [];
    // Snapshot leases are producer-owned resources: payloads name them by key.
    const snapshots = new Map<string, NonNullable<ReturnType<typeof mounts.snapshot>>>();
    handlers.register("guarded", (payload) => {
      const { handle, revision, snapshot } = payload as {
        handle: MountHandle;
        revision: number;
        snapshot?: string;
      };
      return guardMountEffect(mounts, {
        handle,
        channel: "appearance",
        revision,
        policy,
        captured: { points: 40 },
        snapshot: snapshot ? (snapshots.get(snapshot) ?? null) : null,
        services,
        start: () => {
          const made = recordingEffect(100);
          effects.push(made);
          return made.effect;
        },
      });
    });
    const scheduler = createVisualScheduler({ handlers, services });
    return { mounts, scheduler, effects, snapshots };
  }

  it("omits work whose mount is gone before start, building nothing", () => {
    const { mounts, scheduler, effects } = harness("omit");
    const handle = mounts.create({ x: 0 }, { material: "steel" });
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, {
      handler: "guarded",
      payload: { handle, revision: 1 },
      dueUnits: 1,
    });
    scheduler.seal(scope);
    mounts.remove(handle);
    scheduler.update(0, true);
    scheduler.update(1000, true);
    expect(effects).toHaveLength(0);
    expect(scheduler.status(scope).state).toBe("finished");
  });

  it("cancels and disposes once when the mount disappears mid-effect", () => {
    const { mounts, scheduler, effects } = harness("omit");
    const handle = mounts.create({ x: 0 }, { material: "steel" });
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, {
      handler: "guarded",
      payload: { handle, revision: 1 },
      dueUnits: 0,
    });
    scheduler.seal(scope);
    scheduler.update(0, true);
    expect(effects).toHaveLength(1);
    mounts.replaceAppearance(handle, { material: "gold" });
    scheduler.update(20, true);
    scheduler.update(40, true);
    const { log } = effects[0];
    expect(log.filter((entry) => entry === "cancel")).toHaveLength(1);
    expect(log.filter((entry) => entry === "dispose")).toHaveLength(1);
    expect(scheduler.status(scope).state).toBe("finished");
  });

  it("lets an exit finish on its retained snapshot after removal", () => {
    const { mounts, scheduler, effects, snapshots } = harness("retainSnapshot");
    const handle = mounts.create({ x: 0 }, { material: "steel" });
    const released = vi.fn();
    snapshots.set(
      "exit",
      mounts.snapshot(handle, (m) => m.appearance, released)!,
    );
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, {
      handler: "guarded",
      payload: { handle, revision: 1, snapshot: "exit" },
      dueUnits: 0,
    });
    scheduler.seal(scope);
    scheduler.update(0, true);
    mounts.remove(handle);
    scheduler.update(50, true);
    expect(effects[0].log).not.toContain("cancel");
    scheduler.update(200, true);
    expect(scheduler.status(scope).state).toBe("finished");
    expect(released).toHaveBeenCalledTimes(1);
    expect(mounts.resolve(handle)).toBeNull();
  });

  it("presents a required captured summary once, or fails without a sink", () => {
    const sink = { present: vi.fn() };
    const { mounts, scheduler } = harness("requiredSummary", { summarySink: sink });
    const handle = mounts.create({ x: 0 }, { material: "steel" });
    mounts.remove(handle);
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, {
      handler: "guarded",
      payload: { handle, revision: 1 },
      dueUnits: 0,
    });
    scheduler.seal(scope);
    scheduler.update(0, true);
    scheduler.update(10, true);
    expect(sink.present).toHaveBeenCalledTimes(1);
    expect(sink.present).toHaveBeenCalledWith({ points: 40 });
    expect(scheduler.status(scope).state).toBe("finished");

    const bare = harness("requiredSummary", {});
    const gone = bare.mounts.create({ x: 0 }, { material: "steel" });
    bare.mounts.remove(gone);
    const failing = bare.scheduler.createScope(null);
    bare.scheduler.schedule(failing, {
      handler: "guarded",
      payload: { handle: gone, revision: 1 },
      dueUnits: 0,
    });
    bare.scheduler.seal(failing);
    bare.scheduler.update(0, true);
    expect(bare.scheduler.status(failing).state).toBe("failed");
  });
});
