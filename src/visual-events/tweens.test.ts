import { describe, expect, it } from "vite-plus/test";
import { Registry } from "../core/registry";
import {
  createVisualScheduler,
  unitMs,
  type VisualFallback,
  type VisualHandler,
} from "./scheduler";
import { createTweenService, tweenEasings, type TweenValues } from "./tweens";

/** A spec moving `x` from 0 to 10 over `units`, recording what it shows and how it settles. */
function recorder(units = 3) {
  const applied: number[] = [];
  const settled: string[] = [];
  return {
    applied,
    settled,
    spec: {
      from: { x: 0 },
      to: { x: 10 },
      durationUnits: units,
      apply: (values: Readonly<TweenValues>) => void applied.push(values.x),
      settled: (result: string) => void settled.push(result),
    },
  };
}

describe("the Tween.js presentation service (#562)", () => {
  it("progresses with the injected clock, in game units, not wall-clock time", () => {
    const tweens = createTweenService();
    const { spec, applied } = recorder(3);
    const handle = tweens.start(spec, 1000);
    tweens.update(1000 + 1.5 * unitMs);
    expect(handle.values.x).toBeCloseTo(5);
    expect(applied.at(-1)).toBeCloseTo(5);
    // The same timestamp again advances nothing.
    tweens.update(1000 + 1.5 * unitMs);
    expect(applied).toHaveLength(1);
  });

  it("finishes exactly once and leaves the group", () => {
    const tweens = createTweenService();
    const { spec, settled } = recorder(2);
    const handle = tweens.start(spec, 0);
    expect(tweens.size).toBe(1);
    expect(handle.update(2 * unitMs)).toBe("finished");
    expect(handle.update(10 * unitMs)).toBe("finished");
    handle.cancel();
    handle.dispose();
    expect(settled).toEqual(["finished"]);
    expect(handle.state).toBe("finished");
    expect(handle.values.x).toBe(10);
    expect(tweens.size).toBe(0);
  });

  it("cancels exactly once, stops showing and leaves the group", () => {
    const tweens = createTweenService();
    const { spec, settled, applied } = recorder(4);
    const handle = tweens.start(spec, 0);
    tweens.update(unitMs);
    handle.cancel();
    handle.cancel();
    handle.dispose();
    const shown = applied.length;
    tweens.update(10 * unitMs);
    expect(settled).toEqual(["cancelled"]);
    expect(applied).toHaveLength(shown);
    expect(tweens.size).toBe(0);
  });

  it("does nothing on a late frame after disposal, and starts nothing afterwards", () => {
    const tweens = createTweenService();
    const first = recorder(4);
    tweens.start(first.spec, 0);
    tweens.dispose();
    tweens.update(10 * unitMs);
    expect(first.settled).toEqual(["cancelled"]);
    expect(first.applied).toEqual([]);
    const late = recorder(1);
    const handle = tweens.start(late.spec, 20 * unitMs);
    tweens.update(30 * unitMs);
    expect(handle.state).toBe("cancelled");
    expect(late.applied).toEqual([]);
    expect(tweens.size).toBe(0);
  });

  it("runs overlapping effects on separate channels independently", () => {
    const tweens = createTweenService();
    const scale = tweens.start(
      { from: { s: 1 }, to: { s: 2 }, durationUnits: 2, apply: () => {} },
      0,
    );
    const lift = tweens.start(
      { from: { y: 0 }, to: { y: 4 }, durationUnits: 4, apply: () => {} },
      0,
    );
    tweens.update(2 * unitMs);
    expect(scale.state).toBe("finished");
    expect(lift.state).toBe("running");
    expect(lift.values.y).toBeCloseTo(2);
    scale.cancel();
    expect(lift.state).toBe("running");
  });

  it("interrupts from the released pose: a new tween starts where the cancelled one was", () => {
    const tweens = createTweenService();
    const out = tweens.start(
      { from: { x: 0 }, to: { x: 10 }, durationUnits: 4, apply: () => {} },
      0,
    );
    tweens.update(unitMs);
    out.cancel();
    const back = recorder(2);
    const handle = tweens.start({ ...back.spec, from: { ...out.values }, to: { x: 0 } }, unitMs);
    tweens.update(2 * unitMs);
    expect(handle.values.x).toBeCloseTo(1.25);
    tweens.update(4 * unitMs);
    expect(back.settled).toEqual(["finished"]);
    expect(handle.values.x).toBe(0);
  });

  it("takes the immediate path for a zero duration (reduced motion) and still completes", () => {
    const tweens = createTweenService();
    const { spec, settled, applied } = recorder(0);
    const handle = tweens.start(spec, 500);
    expect(handle.update(500)).toBe("finished");
    expect(applied.at(-1)).toBe(10);
    expect(settled).toEqual(["finished"]);
  });

  it("eases by a registered curve's name and refuses an unknown one or a bad spec", () => {
    const tweens = createTweenService();
    const eased = tweens.start(
      { from: { x: 0 }, to: { x: 1 }, durationUnits: 2, easing: "quadIn", apply: () => {} },
      0,
    );
    tweens.update(unitMs);
    expect(eased.values.x).toBeCloseTo(tweenEasings.get("quadIn")(0.5));
    const bad = { from: { x: 0 }, to: { x: 1 }, apply: () => {} };
    expect(() => tweens.start({ ...bad, durationUnits: 1, easing: "nope" }, 0)).toThrow();
    expect(() => tweens.start({ ...bad, durationUnits: -1 }, 0)).toThrow();
    expect(() => tweens.start({ ...bad, to: { y: 1 }, durationUnits: 1 }, 0)).toThrow();
  });

  it("is driven by the scheduler as an effect handle: its scope settles when the tween finishes", () => {
    const tweens = createTweenService();
    const handlers = new Registry<VisualHandler>("test handler");
    const shown: number[] = [];
    handlers.register("slide", (_payload, context) =>
      tweens.start(
        { from: { x: 0 }, to: { x: 1 }, durationUnits: 2, apply: (v) => void shown.push(v.x) },
        context.scheduledAtMs,
      ),
    );
    const scheduler = createVisualScheduler({
      handlers,
      fallbacks: new Registry<VisualFallback>("test fallback"),
    });
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, { handler: "slide", dueUnits: 0 });
    scheduler.seal(scope);
    scheduler.update(0, true);
    scheduler.update(unitMs, true);
    expect(scheduler.status(scope).state).toBe("pending");
    scheduler.update(3 * unitMs, true);
    expect(scheduler.status(scope)).toEqual({ state: "finished" });
    expect(shown.at(-1)).toBe(1);
    expect(tweens.size).toBe(0);
  });

  it("is cancelled with its scope, settling once", () => {
    const tweens = createTweenService();
    const handlers = new Registry<VisualHandler>("test handler");
    const settled: string[] = [];
    handlers.register("slide", (_payload, context) =>
      tweens.start(
        {
          from: { x: 0 },
          to: { x: 1 },
          durationUnits: 8,
          apply: () => {},
          settled: (result) => void settled.push(result),
        },
        context.scheduledAtMs,
      ),
    );
    const scheduler = createVisualScheduler({
      handlers,
      fallbacks: new Registry<VisualFallback>("test fallback"),
    });
    const scope = scheduler.createScope(null);
    scheduler.schedule(scope, { handler: "slide", dueUnits: 0 });
    scheduler.update(0, true);
    scheduler.update(unitMs, true);
    scheduler.cancel(scope);
    scheduler.update(20 * unitMs, true);
    expect(settled).toEqual(["cancelled"]);
    expect(tweens.size).toBe(0);
  });
});
