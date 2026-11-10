import { describe, expect, it } from "vite-plus/test";
import { createActionLog, formatActionLog } from "./action-log";

function clock() {
  let time = 1000;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

describe("action log", () => {
  it("records only while started", () => {
    const log = createActionLog();
    log.record("input", "ignored before start");
    const stop = log.start();
    log.record("input", "kept");
    stop();
    stop();
    log.record("input", "ignored after stop");
    expect(log.entries().map(({ event }) => event)).toEqual(["kept"]);
    expect(log.recording).toBe(false);
  });

  it("keeps the last 30 seconds and throws away anything older", () => {
    const { now, advance } = clock();
    const log = createActionLog(30_000, now);
    log.start();
    for (let n = 0; n < 4; n++) {
      log.record("input", `e${n}`);
      advance(10_000);
    }
    // e0 is now 40 s old and e1 30 s old (still kept, on the edge); e2 and e3 are newer.
    expect(log.entries().map(({ event }) => event)).toEqual(["e1", "e2", "e3"]);
    advance(1);
    expect(log.entries().map(({ event }) => event)).toEqual(["e2", "e3"]);
    // However many fit in the window are kept.
    for (let n = 0; n < 500; n++) log.record("input", `burst${n}`);
    expect(log.entries()).toHaveLength(502);
  });

  it("folds a run of pointer moves into one entry, and starts a new run after another event", () => {
    const { now, advance } = clock();
    const log = createActionLog(30_000, now);
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
    const log = createActionLog(30_000, now);
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
