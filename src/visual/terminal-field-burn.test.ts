import { describe, expect, it } from "vite-plus/test";
import { createVisualScheduler, unitMs, type EffectHandle } from "../visual-events/scheduler";
import {
  burnPlan,
  defaultTerminalBurn,
  startTerminalFieldBurn,
  type TerminalBurnRenderer,
} from "./terminal-field-burn";

/** A renderer that records burns and finishes each after its duration. */
function recorder(fail = false) {
  const log: { id: string; started: number; finished?: number; cancelled?: boolean }[] = [];
  const summaries: string[] = [];
  const renderer: TerminalBurnRenderer = {
    summary: (id) => void summaries.push(id),
    burn(id, { startMs, durationMs }) {
      if (fail) throw new Error("no artwork");
      const entry: (typeof log)[number] = { id, started: startMs };
      log.push(entry);
      // Timed from the scheduled start, not from when it was dispatched.
      const ends = startMs + durationMs;
      return {
        update(nowMs) {
          if (nowMs < ends) return "running";
          entry.finished = nowMs;
          return "finished";
        },
        cancel: () => void (entry.cancelled = true),
        dispose() {},
      } satisfies EffectHandle;
    },
  };
  return { log, summaries, renderer };
}

const ids = (n: number) => Array.from({ length: n }, (_, index) => `g${index}`);
const fixed = () => 0.5;

function harness(n: number, options: { reducedMotion?: boolean; fail?: boolean } = {}) {
  const record = recorder(options.fail);
  const scheduler = createVisualScheduler({ services: { terminalFieldBurn: record.renderer } });
  scheduler.update(0, true);
  const burn = startTerminalFieldBurn(scheduler, {
    ghostIds: ids(n),
    random: fixed,
    reducedMotion: options.reducedMotion ?? false,
  });
  const gate: string[] = [];
  burn.onGate(({ state }) => gate.push(state));
  const step = (ms: number) => {
    scheduler.update(ms, true);
  };
  return { scheduler, burn, gate, step, log: record.log, summaries: record.summaries };
}

describe("the burn plan (#945)", () => {
  it("shuffles once from its cosmetic source and spreads starts within the bound", () => {
    const plan = burnPlan(ids(25), fixed);
    expect([...plan.order].sort()).toEqual([...ids(25)].sort());
    expect(plan.starts[0]).toBe(0);
    expect(plan.starts.at(-1)).toBeCloseTo(defaultTerminalBurn.spreadUnits);
    expect(burnPlan(ids(5), fixed).starts).toEqual([0, 1, 2, 3, 4]);
  });

  it("waits for ceil(80%) of the burns", () => {
    expect([0, 1, 2, 5, 10, 11].map((n) => burnPlan(ids(n), fixed).required)).toEqual([
      0, 1, 2, 4, 8, 9,
    ]);
  });
});

describe("burning the terminal field (#945)", () => {
  it("opens the gate at once for an empty field", () => {
    expect(harness(0).gate).toEqual(["finished"]);
  });

  it("waits for a single burn to finish, not start", () => {
    const { gate, step } = harness(1);
    step(1);
    expect(gate).toEqual([]);
    step(5 * unitMs);
    expect(gate).toEqual([]);
    step(6 * unitMs + 5);
    expect(gate).toEqual(["finished"]);
  });

  it("opens the gate once the required burns finish, while the tail burns on behind it", () => {
    const { gate, step, log, scheduler, burn } = harness(10);
    let ms = 0;
    while (!gate.length && ms < 60 * unitMs) step((ms += unitMs / 2));
    expect(gate).toEqual(["finished"]);
    const finished = log.filter(({ finished: at }) => at !== undefined).length;
    expect(finished).toBeGreaterThanOrEqual(8);
    expect(scheduler.status(burn.tail).state).toBe("pending");
    while (ms < 60 * unitMs) step((ms += unitMs));
    expect(log.every(({ finished: at }) => at !== undefined)).toBe(true);
    expect(scheduler.status(burn.root).state).toBe("finished");
  });

  it("cancels every scheduled and running burn with its root", () => {
    const { step, log, scheduler, burn, gate } = harness(10);
    step(2 * unitMs);
    burn.cancel();
    expect(
      log.filter(({ finished: at }) => at === undefined).every(({ cancelled }) => cancelled),
    ).toBe(true);
    const started = log.length;
    step(30 * unitMs);
    expect(log.length).toBe(started);
    expect(scheduler.status(burn.root).state).toBe("cancelled");
    expect(gate).toEqual(["cancelled"]);
  });

  it("shows each summary promptly with reduced motion, drawing no burn", () => {
    const { gate, step, log, summaries } = harness(10, { reducedMotion: true });
    step(13 * unitMs);
    expect(log).toEqual([]);
    expect([...summaries].sort()).toEqual([...ids(10)].sort());
    expect(gate).toEqual(["finished"]);
  });

  it("times a late-dispatched burn from its scheduled start", () => {
    const { step, log } = harness(5);
    // One late frame dispatches every start at once.
    step(10 * unitMs);
    expect(log.map(({ started }) => Math.round(started / unitMs)).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it("summarizes and reports burns the scheduler refuses", () => {
    const record = recorder();
    const scheduler = createVisualScheduler({
      services: { terminalFieldBurn: record.renderer },
      limits: { pendingPerScope: 2 },
    });
    scheduler.update(0, true);
    const burn = startTerminalFieldBurn(scheduler, {
      ghostIds: ids(5),
      random: fixed,
      reducedMotion: false,
      renderer: record.renderer,
    });
    expect(burn.summarized.length).toBeGreaterThan(0);
    expect(record.summaries).toEqual(burn.summarized);
  });

  it("never leaves the gate pending when rendering fails, summarizing instead", () => {
    const { gate, step, summaries } = harness(3, { fail: true });
    for (let ms = 1; ms < 10 * unitMs; ms += unitMs) step(ms);
    expect(gate).toEqual(["finished"]);
    expect(summaries).toHaveLength(3);
  });
});
