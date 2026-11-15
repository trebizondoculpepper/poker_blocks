/**
 * Presentation mount bindings with captured, commit-side reconciliation (#1163;
 * doc/visual-event-interface.md, "Captured snapshots and missing presentation mounts (#1161)").
 *
 * - **Handles.** A mounted visual has an opaque handle scoped to the registry's presentation
 *   generation. A handle is lookup only: resolving it returns its current channels, or null once
 *   it was removed or its generation ended. Reusing a model id or cell never makes an old handle
 *   resolve to a new object; each mount gets a fresh handle.
 * - **Channels.** Pose and appearance are owned independently, each with its own binding
 *   revision. Replacing the appearance keeps the pose (an in-flight block keeps moving) and
 *   invalidates only appearance leases; removal invalidates both.
 * - **Leases.** An effect acquires a lease on one channel at the revision it captured. The lease
 *   is valid while that revision holds; the registry notifies and releases it once on any
 *   invalidation. A retained snapshot is a separate, effect-owned lease on captured data that
 *   outlives removal but never resolves as a live mount.
 * - **Projection updates.** The model-to-presentation controller publishes captured create /
 *   replace / remove updates, each naming a registered projection handler and carrying a
 *   monotonic correlation. Stale or out-of-order corrections are refused, never applied.
 *   Handlers build or swap presentation resources; they get no run, RNG or gameplay command.
 * - **Missing-mount policies** are registered handlers selected by reference from composition
 *   (omit, retain a captured snapshot, required captured summary), checked at start and while
 *   running, settling exactly once.
 *
 * It never reads `GameRun`; everything it knows was captured at commit and published to it.
 */
import { Registry } from "../core/registry";
import type { EffectHandle } from "./scheduler";

declare const mountBrand: unique symbol;
/**
 * Opaque: code holds it, never reads into it. A plain branded string, so it survives the
 * scheduler's captured payloads (`capturePayload`) and still resolves to the same mount.
 */
export type MountHandle = string & { readonly [mountBrand]: true };

export type MountChannel = "pose" | "appearance";

export type ResolvedMount<Pose, Appearance> = {
  pose: Pose;
  appearance: Appearance;
  revisions: Readonly<Record<MountChannel, number>>;
};

export type MountLease = {
  /** True while the channel is still at the revision this lease captured. */
  readonly valid: boolean;
  /** Release it; safe to call more than once. */
  release(): void;
};

export type SnapshotLease<Captured> = {
  /** The data captured at commit: never the live object. */
  readonly captured: Captured;
  readonly released: boolean;
  release(): void;
};

/** A captured update from the model-to-presentation controller. */
export type MountProjectionUpdate = {
  /** The registered projection handler that applies it. */
  handler: string;
  /** Monotonic within a mount: the committed action/revision order. */
  correlation: number;
  /** Captured instance/appearance/ownership data, plain and immutable. */
  payload: unknown;
};

type Entry<Pose, Appearance> = {
  generation: number;
  pose: Pose;
  appearance: Appearance;
  revisions: Record<MountChannel, number>;
  correlation: number;
  leases: Set<{ channel: MountChannel; revision: number; invalidate(): void }>;
};

/** What a projection handler may do: apply captured data to presentation, nothing else. */
export type MountProjectionContext<Pose, Appearance> = {
  create(pose: Pose, appearance: Appearance): MountHandle;
  replaceAppearance(handle: MountHandle, appearance: Appearance): boolean;
  replacePose(handle: MountHandle, pose: Pose): boolean;
  remove(handle: MountHandle): boolean;
  /** Presentation services the handler applies its change through. */
  services: unknown;
};

export type MountProjection = (
  payload: unknown,
  context: MountProjectionContext<unknown, unknown>,
  target: MountHandle | null,
) => void;

export const mountProjections = new Registry<MountProjection>("mount projection");

export function createMountRegistry<Pose, Appearance>(services: unknown = null) {
  let generation = 1;
  let nextId = 1;
  const entries = new Map<MountHandle, Entry<Pose, Appearance>>();

  const live = (handle: MountHandle | null): Entry<Pose, Appearance> | null => {
    if (!handle) return null;
    const entry = entries.get(handle);
    return entry && entry.generation === generation ? entry : null;
  };

  /** Invalidate leases on `channels` (all their revisions) for one entry, each exactly once. */
  const invalidate = (entry: Entry<Pose, Appearance>, channels: readonly MountChannel[]) => {
    for (const lease of Array.from(entry.leases))
      if (channels.includes(lease.channel)) lease.invalidate();
  };

  const create = (pose: Pose, appearance: Appearance): MountHandle => {
    const handle = `mount:${generation}:${nextId++}` as MountHandle;
    const entry: Entry<Pose, Appearance> = {
      generation,
      pose,
      appearance,
      revisions: { pose: 1, appearance: 1 },
      correlation: 0,
      leases: new Set(),
    };
    entries.set(handle, entry);
    return handle;
  };

  const bump = (handle: MountHandle, channel: MountChannel, value: Pose | Appearance) => {
    const entry = live(handle);
    if (!entry) return false;
    if (channel === "pose") entry.pose = value as Pose;
    else entry.appearance = value as Appearance;
    entry.revisions[channel] += 1;
    invalidate(entry, [channel]);
    return true;
  };

  const remove = (handle: MountHandle) => {
    const entry = live(handle);
    if (!entry) return false;
    entries.delete(handle);
    invalidate(entry, ["pose", "appearance"]);
    return true;
  };

  const resolve = (handle: MountHandle | null): ResolvedMount<Pose, Appearance> | null => {
    const entry = live(handle);
    return entry
      ? { pose: entry.pose, appearance: entry.appearance, revisions: { ...entry.revisions } }
      : null;
  };

  const replaceAppearance = (handle: MountHandle, appearance: Appearance) =>
    bump(handle, "appearance", appearance);
  const replacePose = (handle: MountHandle, pose: Pose) => bump(handle, "pose", pose);
  const context: MountProjectionContext<Pose, Appearance> = {
    create,
    replaceAppearance,
    replacePose,
    remove,
    services,
  };

  return {
    get generation() {
      return generation;
    },
    create,
    resolve,
    replaceAppearance,
    replacePose,
    remove,
    /**
     * Lease one channel at the revision the effect captured (default: the current one). Null if
     * the mount is gone or already past that revision. `onInvalidated` runs once, if ever.
     */
    acquire(
      handle: MountHandle,
      channel: MountChannel,
      onInvalidated: () => void = () => {},
      revision?: number,
    ): MountLease | null {
      const entry = live(handle);
      if (!entry) return null;
      const at = revision ?? entry.revisions[channel];
      if (entry.revisions[channel] !== at) return null;
      let valid = true;
      const record = {
        channel,
        revision: at,
        invalidate() {
          if (!valid) return;
          valid = false;
          entry.leases.delete(record);
          onInvalidated();
        },
      };
      entry.leases.add(record);
      return {
        get valid() {
          return valid;
        },
        release() {
          if (!valid) return;
          valid = false;
          entry.leases.delete(record);
        },
      };
    },
    /**
     * Capture an effect-owned snapshot at commit, independent of the live mount: it survives the
     * mount's removal and never resolves as a live mount. `dispose` frees what it holds, once.
     */
    snapshot<Captured>(
      handle: MountHandle,
      capture: (mount: ResolvedMount<Pose, Appearance>) => Captured,
      dispose: (captured: Captured) => void = () => {},
    ): SnapshotLease<Captured> | null {
      const resolved = resolve(handle);
      if (!resolved) return null;
      const captured = capture(resolved);
      let released = false;
      return {
        captured,
        get released() {
          return released;
        },
        release() {
          if (released) return;
          released = true;
          dispose(captured);
        },
      };
    },
    /**
     * Apply a committed projection update through its registered handler. An update older than
     * one already applied to the same mount is refused; so is one for a stale handle.
     */
    publish(update: MountProjectionUpdate, target: MountHandle | null = null): boolean {
      if (target) {
        const entry = live(target);
        if (!entry || update.correlation <= entry.correlation) return false;
        entry.correlation = update.correlation;
      }
      mountProjections.get(update.handler)(
        update.payload,
        context as MountProjectionContext<unknown, unknown>,
        target,
      );
      return true;
    },
    /**
     * End this presentation generation (reset, exit, restore): every handle goes stale and every
     * lease is invalidated once. Retained snapshots belong to their effects and are untouched.
     */
    resetGeneration() {
      const old = Array.from(entries.values());
      entries.clear();
      generation += 1;
      for (const entry of old) invalidate(entry, ["pose", "appearance"]);
    },
  };
}

export type MountRegistry<Pose = unknown, Appearance = unknown> = ReturnType<
  typeof createMountRegistry<Pose, Appearance>
>;

/** What a missing-mount policy is asked to decide, and with what captured data. */
export type MissingMountCase = {
  /** Before the effect built anything, or while it was running. */
  when: "start" | "during";
  /** The effect's captured payload: a summary sink presents this, never live state. */
  captured: unknown;
  /** The effect's retained snapshot, if it acquired one at commit. */
  snapshot: SnapshotLease<unknown> | null;
  services: unknown;
};

/**
 * A policy's decision: settle omitted; keep presenting the retained snapshot; or the captured
 * summary was presented (it settles). `fail` reports a required summary that could not show.
 */
export type MissingMountOutcome = "omit" | "retain" | "summarised" | { fail: string };

export type MissingMountPolicy = (missing: MissingMountCase) => MissingMountOutcome;

export const missingMountPolicies = new Registry<MissingMountPolicy>("missing mount policy");

/** Cosmetic work: nothing to show without its mount. */
missingMountPolicies.register("omit", () => "omit");

/** An exit/reveal that acquired a snapshot at commit finishes on it; without one, it omits. */
missingMountPolicies.register("retainSnapshot", ({ snapshot }) =>
  snapshot && !snapshot.released ? "retain" : "omit",
);

/** Services a required summary presents through: the existing bounded fallback sink. */
export type SummarySinkServices = { summarySink?: { present(captured: unknown): void } };

/** Required narration: present the captured summary directly, or fail with a diagnostic. */
missingMountPolicies.register("requiredSummary", ({ captured, services }) => {
  const sink = (services as SummarySinkServices | null)?.summarySink;
  if (!sink) return { fail: "required summary sink unavailable" };
  sink.present(captured);
  return "summarised";
});

/**
 * Wrap an effect bound to one mount with its registered missing-mount policy. Before start the
 * mount is checked at the captured revision; while running, invalidation of its lease consults
 * the policy. The effect's own resources are disposed exactly once on every path, and it never
 * rebinds to a newer revision.
 */
export function guardMountEffect(
  registry: Pick<MountRegistry<unknown, unknown>, "acquire">,
  options: {
    handle: MountHandle;
    channel: MountChannel;
    revision: number;
    policy: string;
    captured: unknown;
    snapshot?: SnapshotLease<unknown> | null;
    services: unknown;
    /** Build the effect once its mount is known to be valid. */
    start(): EffectHandle;
  },
): "done" | EffectHandle {
  const policy = missingMountPolicies.get(options.policy);
  const snapshot = options.snapshot ?? null;
  const decide = (when: "start" | "during") =>
    policy({ when, captured: options.captured, snapshot, services: options.services });
  const settleWithout = (outcome: MissingMountOutcome) => {
    if (typeof outcome === "object") throw new Error(outcome.fail);
  };

  let missing = false;
  const lease = registry.acquire(
    options.handle,
    options.channel,
    () => {
      missing = true;
    },
    options.revision,
  );
  if (!lease) {
    const outcome = decide("start");
    if (outcome !== "retain") {
      snapshot?.release();
      settleWithout(outcome);
      return "done";
    }
  }
  const effect = options.start();
  let settled = false;
  let retaining = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    lease?.release();
    effect.dispose();
    snapshot?.release();
  };
  return {
    update(nowMs) {
      if (settled) return "finished";
      if (missing && !retaining) {
        missing = false;
        const outcome = decide("during");
        if (outcome === "retain") retaining = true;
        else {
          effect.cancel();
          finish();
          settleWithout(outcome);
          return "finished";
        }
      }
      const state = effect.update(nowMs);
      if (state === "finished") finish();
      return state;
    },
    cancel() {
      if (settled) return;
      effect.cancel();
      finish();
    },
    dispose() {
      finish();
    },
  };
}
