import { describe, expect, it } from "vite-plus/test";
import { createActionLog, formatActionLog } from "./action-log";

function clock() {
  let time = 1000;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

describe("action log", () => {
  it("records only while started", () => {
    const log = createActionLog(100);
    log.record("input", "ignored before start");
    const stop = log.start();
    log.record("input", "kept");
    stop();
    stop();
    log.record("input", "ignored after stop");
    expect(log.entries().map(({ event }) => event)).toEqual(["kept"]);
    expect(log.recording).toBe(false);
  });

  it("keeps the last 100 entries", () => {
    const log = createActionLog(100);
    log.start();
    for (let n = 0; n < 130; n++) log.record("input", `e${n}`);
    expect(log.entries()).toHaveLength(100);
    expect(log.entries()[0]!.event).toBe("e30");
  });

  it("folds a run of pointer moves into one entry, and starts a new run after another event", () => {
    const { now, advance } = clock();
    const log = createActionLog(100, now);
    log.start();
    for (let n = 0; n < 5; n++) {
      log.move(10 * n, 20);
      advance(16);
    }
    log.record("pointer", "up");
    log.move(1, 2);
    const events = log.entries().map(({ event, detail }) => `${event} ${detail}`);
    expect(events[0]).toContain("move ×5 over 64.0ms, last at (40,20)");
    expect(events[1]).toBe("up ");
    expect(events[2]).toContain("move ×1");
  });

  it("stamps each entry with its time and frame, and formats them for pasting", () => {
    const { now, advance } = clock();
    const log = createActionLog(100, now);
    log.start();
    log.record("pointer", "down", "mouse (5,6)");
    advance(12.34);
    log.tick();
    log.record("input", "drop held", "waiting");
    const text = formatActionLog(log.entries(), [["mode", "dev10"]]);
    expect(text.split("\n")).toEqual([
      "# mode: dev10",
      "+      0.0ms f0      pointer  down: mouse (5,6)",
      "+     12.3ms f1      input    drop held: waiting",
      "",
    ]);
  });
});
