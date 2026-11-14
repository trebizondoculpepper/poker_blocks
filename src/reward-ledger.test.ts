import { describe, expect, it } from "vite-plus/test";
import {
  captureLedger,
  ledgerTiming,
  presentLedger,
  type CapturedLedger,
  type LedgerSink,
} from "./reward-ledger";
import type { RewardEntry, StageReward } from "./stage-rewards";
import { createVisualScheduler, unitMs, visualHandlers } from "./visual-events/scheduler";

const ledger: CapturedLedger = {
  rows: [
    { label: "Stage complete", value: "+4 coins", cue: "reward.coin" },
    { label: "Unused plays", value: "+2 coins", cue: "reward.coin" },
  ],
  totals: { total: "+6", balance: "9" },
};

/** A real scheduler on injected time, showing the ledger into a log. */
function showing(limits: Parameters<typeof createVisualScheduler>[0] = {}) {
  const log: string[] = [];
  let finished = 0;
  const sink: LedgerSink = {
    row: ({ label }) => void log.push(`${Math.round(scheduler.nowMs)}:row ${label}`),
    finish: ({ total }) => {
      finished++;
      log.push(`${Math.round(scheduler.nowMs)}:finish ${total}`);
    },
    summarise: ({ rows, totals }) => {
      log.push(`${Math.round(scheduler.nowMs)}:summary ${rows.length}`);
      sink.finish(totals);
    },
  };
  const scheduler = createVisualScheduler({ ...limits, services: { rewardLedger: sink } });
  let real = 1000;
  scheduler.update(real, true);
  const advance = (ms: number, step = 1) => {
    for (let t = 0; t < ms; t += step) scheduler.update((real += step), true);
  };
  return { log, sink, scheduler, advance, finished: () => finished };
}

describe("the stage-won ledger on the shared scheduler (#950)", () => {
  it("counts rows in ledger order a step apart, then finishes once, a step after the last", () => {
    const { log, sink, scheduler, advance, finished } = showing();
    const scope = presentLedger(scheduler, sink, ledger, { reduced: false })!;
    advance(2000);
    const step = Math.round(ledgerTiming.rowStep * unitMs);
    expect(step).toBe(250);
    // Each starts on the first 1 ms update at or after its due time.
    const at = (rows: number) => Math.ceil(rows * ledgerTiming.rowStep * unitMs);
    expect(log).toEqual([
      `${at(1)}:row Stage complete`,
      `${at(2)}:row Unused plays`,
      `${at(3)}:finish +6`,
    ]);
    expect(finished()).toBe(1);
    expect(scheduler.status(scope)).toEqual({ state: "finished" });
  });

  it("shows nothing more once the screen closes, and never finishes later", () => {
    const { log, sink, scheduler, advance, finished } = showing();
    const scope = presentLedger(scheduler, sink, ledger, { reduced: false })!;
    advance(300);
    scheduler.cancel(scope);
    advance(2000);
    expect(log).toEqual([`${Math.ceil(ledgerTiming.rowStep * unitMs)}:row Stage complete`]);
    expect(finished()).toBe(0);
    expect(scheduler.counts.active).toBe(0);
  });

  it("completes promptly under reduced motion, through the same rows and finish", () => {
    const { log, sink, scheduler, advance, finished } = showing();
    presentLedger(scheduler, sink, ledger, { reduced: true });
    advance(1);
    expect(log).toEqual(["1:row Stage complete", "1:row Unused plays", "1:finish +6"]);
    expect(finished()).toBe(1);
  });

  it("summarises at once, and still finishes, when the ledger can't be admitted", () => {
    const { log, sink, scheduler } = showing({ limits: { pendingPerScope: 1 } });
    expect(presentLedger(scheduler, sink, ledger, { reduced: false })).toBeNull();
    expect(log).toEqual(["0:summary 2", "0:finish +6"]);
  });

  it("falls back to the captured summary when a row fails, and still finishes once", () => {
    const log: string[] = [];
    let finished = 0;
    let rows = 0;
    const sink: LedgerSink = {
      row: ({ label }) => {
        if (++rows === 2) throw new Error("broken row");
        log.push(`row ${label}`);
      },
      finish: () => void finished++,
      summarise: ({ rows: all, totals }) => {
        log.push(`summary ${all.length}`);
        sink.finish(totals);
      },
    };
    const scheduler = createVisualScheduler({ services: { rewardLedger: sink } });
    let real = 0;
    scheduler.update(real, true);
    presentLedger(scheduler, sink, ledger, { reduced: false });
    for (let t = 0; t < 2000; t += 10) scheduler.update((real += 10), true);
    expect(log).toEqual(["row Stage complete", "summary 2"]);
    expect(finished).toBe(1);
  });

  it("captures each row through its registered presentation, and the paid totals", () => {
    const reward: StageReward = {
      entries: [
        {
          source: "stage",
          label: "Stage complete",
          effects: [{ id: "coins", config: { amount: 4 } }],
          presentation: "coins",
        } as RewardEntry,
      ],
      balanceBefore: 5,
      balance: 9,
    };
    expect(captureLedger(reward)).toEqual({
      rows: [{ label: "Stage complete", value: "+4 coins", cue: "reward.coin" }],
      totals: { total: "+4", balance: "9" },
    });
  });

  it("registers its handlers on the shared scheduler", () => {
    expect(visualHandlers.has("ledger.row")).toBe(true);
    expect(visualHandlers.has("ledger.finish")).toBe(true);
  });
});
