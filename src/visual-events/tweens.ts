/**
 * The Tween.js presentation service (#562; doc/tweening-library-research.md, "How it integrates",
 * and doc/visual-event-interface.md, "Clock and deterministic dispatch"). Finite numeric
 * interpolation only: an effect or controller trait chooses the endpoints, duration, easing and
 * what the values move; the visual-event scheduler decides when it starts. This is the only file
 * that imports Tween.js.
 *
 * - **One clock.** Each service owns one manual `Group`, advanced with the shared presentation
 *   clock's `nowMs`. Never wall-clock time, the global group or a loop of its own.
 * - **Game units** become milliseconds only here (1 unit = 1000/15 ms).
 * - **Exactly once.** A tween settles once, as finished or cancelled: it leaves the group, its
 *   `settled` callback runs, and it drops what it captured. Calls after that, or after the service
 *   is disposed, do nothing.
 * - **Presentation only.** A spec gets no scheduling or model access. A follow-up goes through the
 *   scheduler from the handler that started the tween, never from a tween callback.
 * - **Scheduler-ready.** A handle is a scheduler `EffectHandle`, so a handler can return it.
 */
import { Easing, Group, Tween } from "@tweenjs/tween.js";
import { Registry } from "../core/registry";
import { unitsToMs, type EffectHandle } from "./scheduler";

export type TweenValues = Record<string, number>;

/** What to interpolate, chosen by the effect that starts it. */
export type TweenSpec = {
  /** Captured start and end values, one number per channel. */
  from: TweenValues;
  to: TweenValues;
  /** In game-time units; 0 (a reduced-motion path) reaches `to` on the first update. */
  durationUnits: number;
  /** A registered easing's name; linear when omitted. */
  easing?: string;
  /** Show the current values: presentation only, never gameplay. */
  apply: (values: Readonly<TweenValues>) => void;
  /** Hear the one settlement. */
  settled?: (result: "finished" | "cancelled") => void;
};

export type TweenHandle = EffectHandle & {
  readonly state: "running" | "finished" | "cancelled";
  /** The values last applied: where an interrupting effect starts from. */
  readonly values: Readonly<TweenValues>;
};

/** Easing curves by name: configuration names one, never code that asks what an effect is. */
export const tweenEasings = new Registry<(amount: number) => number>("tween easing");
const easings: [string, (amount: number) => number][] = [
  ["linear", Easing.Linear.None],
  ["quadIn", Easing.Quadratic.In],
  ["quadOut", Easing.Quadratic.Out],
  ["quadInOut", Easing.Quadratic.InOut],
  ["cubicOut", Easing.Cubic.Out],
  ["cubicInOut", Easing.Cubic.InOut],
  ["backOut", Easing.Back.Out],
  ["elasticOut", Easing.Elastic.Out],
];
for (const [name, curve] of easings)
  if (!tweenEasings.has(name)) tweenEasings.register(name, curve);

export function createTweenService() {
  const group = new Group();
  const live = new Set<() => void>();
  let lastUpdate = -Infinity;
  let disposed = false;

  /** Advance every tween to `nowMs`, for a caller that drives the service directly. */
  function update(nowMs: number): void {
    if (disposed || nowMs <= lastUpdate) return;
    lastUpdate = nowMs;
    group.update(nowMs);
  }

  return {
    /** Start interpolating at `nowMs` (the effect's scheduled start, which may be in the past). */
    start(spec: TweenSpec, nowMs: number): TweenHandle {
      const missing = Object.keys(spec.to).filter((key) => !(key in spec.from));
      if (missing.length) throw new Error(`tween has no start value for ${missing.join(", ")}`);
      if (!(Number.isFinite(spec.durationUnits) && spec.durationUnits >= 0))
        throw new Error(`Invalid tween duration: ${spec.durationUnits}`);
      const easing = tweenEasings.get(spec.easing ?? "linear");
      const values: TweenValues = { ...spec.from };
      let state: TweenHandle["state"] = "running";
      let apply: TweenSpec["apply"] | null = spec.apply;
      let settled: TweenSpec["settled"] | null = spec.settled ?? null;
      const tween = new Tween(values)
        .to({ ...spec.to }, unitsToMs(spec.durationUnits))
        .easing(easing)
        .onUpdate((current) => apply?.(current))
        .onComplete(() => settle("finished"));
      function settle(result: "finished" | "cancelled"): void {
        if (state !== "running") return;
        state = result;
        group.remove(tween);
        live.delete(cancel);
        const hear = settled;
        // Released: nothing it captured outlives it.
        apply = settled = null;
        hear?.(result);
      }
      function cancel(): void {
        if (state !== "running") return;
        tween.stop();
        settle("cancelled");
      }
      if (disposed) {
        state = "cancelled";
        apply = settled = null;
      } else {
        group.add(tween);
        live.add(cancel);
        tween.start(nowMs);
      }
      return {
        get state() {
          return state;
        },
        get values() {
          return values;
        },
        // Advances only this tween, so a throwing callback fails its own scheduler scope and
        // never another effect's (#1019 review). Tween.js computes from elapsed time, so a later
        // service-wide `update` at the same timestamp changes nothing.
        update(now) {
          if (!disposed && state === "running") tween.update(now);
          return state === "running" ? "running" : "finished";
        },
        cancel,
        dispose: cancel,
      };
    },
    update,
    /** Tweens still running. */
    get size(): number {
      return live.size;
    },
    /** Cancel every tween; this service starts nothing more, and late calls do nothing. */
    dispose(): void {
      // Disposed first: a tween started from a cancellation callback is refused, not leaked
      // (#1019 review).
      disposed = true;
      // Every tween is cancelled even when a settlement callback throws; the first error is
      // reported once all are released (#1019 review).
      let failure: { error: unknown } | null = null;
      for (const cancel of Array.from(live))
        try {
          cancel();
        } catch (error) {
          failure ??= { error };
        }
      if (failure) throw failure.error;
    },
  };
}

export type TweenService = ReturnType<typeof createTweenService>;
