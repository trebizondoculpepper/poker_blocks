import { describe, expect, it } from "vite-plus/test";
import {
  createGhostTiming,
  type GhostDecoration,
  type GhostTimingSettings,
} from "./drag-ghost-timing";
import { createVisualScheduler, unitMs } from "./visual-events/scheduler";

/** A stub decoration recording what the controller asked of it. */
function stub() {
  const made: { log: string[]; progress: number[] }[] = [];
  const decorate = (): GhostDecoration => {
    const record = { log: [] as string[], progress: [] as number[] };
    made.push(record);
    return {
      setProgress: (p) => void record.progress.push(Math.round(p * 100) / 100),
      follow: () => void record.log.push("follow"),
      restoreSource: () => void record.log.push("restore"),
      release: () => void record.log.push("release"),
    };
  };
  return { made, decorate };
}

function harness() {
  const scheduler = createVisualScheduler();
  let now = 0;
  scheduler.update(0, true);
  const step = (ms: number) => {
    for (let t = 0; t < ms; t += 10) scheduler.update((now += 10), true);
  };
  const { made, decorate } = stub();
  return { timing: createGhostTiming(scheduler, decorate), made, step, scheduler };
}

const settings = (over: Partial<GhostTimingSettings> = {}): GhostTimingSettings => ({
  delayUnits: 3,
  durationUnits: 5,
  baseline: false,
  reducedMotion: false,
  ...over,
});

describe("drag-ghost gesture timing (#1084; doc/drag-ghost-audition.md)", () => {
  it("waits the captured delay, then drives progress 0→1 over the captured duration", () => {
    const { timing, made, step } = harness();
    timing.began("card", settings());
    step(3 * unitMs - 20);
    expect(made[0]!.progress).toEqual([0]);
    step(5 * unitMs + 60);
    expect(made[0]!.progress.at(-1)).toBe(1);
    expect(made[0]!.progress.length).toBeGreaterThan(3);
  });

  it("captures settings at began: later edits don't reach the gesture", () => {
    const { timing } = harness();
    const live = { ...settings() };
    const gesture = timing.began("card", live);
    live.delayUnits = 99;
    expect(gesture.settings.delayUnits).toBe(3);
    expect(Object.isFrozen(gesture.settings)).toBe(true);
  });

  it("never ghosts after a quick drop before the delay", () => {
    const { timing, made, step } = harness();
    const gesture = timing.began("card", settings());
    step(50);
    gesture.end("accepted");
    step(1000);
    expect(made[0]!.progress).toEqual([0]);
    expect(made[0]!.log).toEqual(["release"]);
  });

  it("settles directly at zero delay and duration", () => {
    const { timing, made, step } = harness();
    timing.began("card", settings({ delayUnits: 0, durationUnits: 0 }));
    step(20);
    expect(made[0]!.progress).toEqual([0, 1]);
  });

  it("shows the endpoint at once under reduced motion, and nothing at all for baseline", () => {
    const { timing, made } = harness();
    timing.began("card", settings({ reducedMotion: true }));
    expect(made[0]!.progress).toEqual([1]);
    const baseline = timing.began("card", settings({ baseline: true }));
    expect(made).toHaveLength(1);
    expect(baseline.end("rejected")).toBe(true);
  });

  it("restores the source on a partial-fade reject, and only releases on accept, once", () => {
    const { timing, made, step } = harness();
    const rejected = timing.began("a", settings({ delayUnits: 0, durationUnits: 30 }));
    step(200);
    expect(rejected.end("rejected")).toBe(true);
    expect(rejected.end("cancelled")).toBe(false);
    expect(made[0]!.log).toEqual(["restore", "release"]);
    const accepted = timing.began("b", settings({ delayUnits: 0, durationUnits: 30 }));
    step(200);
    accepted.end("accepted");
    expect(made[1]!.log).toEqual(["release"]);
  });

  it("follows the carried transform without restarting the delay, and stops after end", () => {
    const { timing, made, step } = harness();
    const gesture = timing.began("card", settings());
    step(3 * unitMs - 30);
    gesture.changed({ x: 1 });
    step(60);
    // Started on the original schedule despite the move.
    expect(made[0]!.progress.length).toBeGreaterThan(1);
    gesture.end("cancelled");
    gesture.changed({ x: 2 });
    expect(made[0]!.log).toEqual(["follow", "restore", "release"]);
  });

  it("gives each gesture its own generation and settings; a stale one stops being current", () => {
    const { timing } = harness();
    const first = timing.began("a", settings());
    const second = timing.began("b", settings({ delayUnits: 7 }));
    expect(first.current).toBe(false);
    expect(second.current).toBe(true);
    expect(second.settings.delayUnits).toBe(7);
  });

  it("anchors the fade to its scheduled start, so a late frame doesn't shorten it (#1291)", () => {
    const scheduler = createVisualScheduler();
    scheduler.update(0, true);
    const { made, decorate } = stub();
    const timing = createGhostTiming(scheduler, decorate);
    timing.began("card", settings({ delayUnits: 3, durationUnits: 6 }));
    // One late frame well past the due time: progress reflects the scheduled start.
    scheduler.update(3 * unitMs + 3 * unitMs, true);
    scheduler.update(3 * unitMs + 3 * unitMs + 1, true);
    expect(made[0]!.progress.at(-1)).toBeCloseTo(0.5, 1);
  });
});
