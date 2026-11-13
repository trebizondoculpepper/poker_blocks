import { describe, expect, it } from "vite-plus/test";
import { createScoreNarration, type NarratedLine } from "./score-narration";
import { createVisualScheduler, unitMs } from "./visual-events/scheduler";

const line = (id: string, points: number): NarratedLine => ({
  blockIds: [id],
  sourceIds: [`source-${id}`],
  points,
});

/** A real scheduler on injected time, narrating into a log. */
function narrating(limits: Parameters<typeof createVisualScheduler>[0] = {}) {
  const log: string[] = [];
  let shown = 0;
  const sink = {
    line(entry: NarratedLine) {
      shown += entry.points;
      log.push(`${Math.round(scheduler.nowMs)}:line ${entry.blockIds.join()}`);
    },
    summarise() {
      log.push(`${Math.round(scheduler.nowMs)}:summary`);
    },
    decide() {
      log.push(`${Math.round(scheduler.nowMs)}:outcome`);
    },
  };
  const scheduler = createVisualScheduler({ ...limits, services: { scoreNarration: sink } });
  // 2 units between lines, 6 units to settle: 133⅓ ms and 400 ms.
  const narration = createScoreNarration(scheduler, sink, { lineStep: 2, settle: 6 });
  let real = 1000;
  scheduler.update(real, true);
  const advance = (ms: number, step = 10) => {
    for (let t = 0; t < ms; t += step) scheduler.update((real += step), true);
  };
  return { log, narration, scheduler, advance, shown: () => shown };
}

describe("score narration on the visual-event scheduler (#547)", () => {
  it("shows a play's lines one step apart, then the outcome once the last tint settles", () => {
    const { log, narration, advance, shown } = narrating();
    narration.narrate([line("a", 10), line("b", 20)]);
    expect(narration.presenting).toBe(true);
    advance(1000);
    // Lines at 0 and 2 units; the outcome 6 units after the last line.
    expect(log).toEqual(["10:line a", "140:line b", "540:outcome"]);
    expect(shown()).toBe(30);
    expect(narration.presenting).toBe(false);
  });

  it("narrates a later play after the earlier play's scope settles, and announces once", () => {
    const { log, narration, advance } = narrating();
    narration.narrate([line("a", 1), line("b", 1)]);
    advance(50);
    // Committed while play 1 narrates: its lines were captured now, and wait their turn.
    narration.narrate([line("c", 1)]);
    advance(1000);
    // Play 1's scope settles a step after its last line (≈267 ms); play 2 starts then.
    expect(log).toEqual(["10:line a", "140:line b", "270:line c", "680:outcome"]);
  });

  it("cancels a pending outcome when another play commits before it shows", () => {
    const { log, narration, advance } = narrating();
    narration.narrate([line("a", 1)]);
    advance(300);
    narration.narrate([line("b", 1)]);
    advance(1000);
    expect(log.filter((entry) => entry.endsWith("outcome"))).toHaveLength(1);
    expect(log.at(-1)).toMatch(/outcome$/);
    expect(log.indexOf(log.find((entry) => entry.endsWith("line b"))!)).toBeLessThan(
      log.length - 1,
    );
  });

  it("announces at once after a play that scores nothing", () => {
    const { log, narration, advance } = narrating();
    narration.narrate([]);
    advance(20);
    expect(log).toEqual(["10:outcome"]);
  });

  it("shows nothing more after a reset, and leaves no scope or event behind", () => {
    const { log, narration, advance, scheduler } = narrating();
    narration.narrate([line("a", 1), line("b", 1)]);
    narration.narrate([line("c", 1)]);
    advance(20);
    narration.reset();
    advance(1000);
    expect(log).toEqual(["10:line a"]);
    expect(narration.presenting).toBe(false);
    expect(scheduler.counts).toMatchObject({ pending: 0, active: 0, heap: 0, entries: 0 });
  });

  it("summarises and still announces when a play's lines can't be admitted", () => {
    const { log, narration, advance } = narrating({ limits: { pendingPerScope: 1 } });
    narration.narrate([line("a", 1), line("b", 1)]);
    advance(20);
    expect(log).toEqual(["0:summary", "10:outcome"]);
  });

  it("holds narration while the page is hidden, and resumes where it stopped", () => {
    const { log, narration, scheduler } = narrating();
    narration.narrate([line("a", 1), line("b", 1)]);
    scheduler.update(1010, true);
    scheduler.update(5000, false);
    scheduler.update(9000, true);
    scheduler.update(9100, true);
    expect(log).toEqual(["10:line a"]);
    scheduler.update(9140, true);
    expect(log).toEqual(["10:line a", "150:line b"]);
  });

  it("shows lines as captured when their play committed, not as later changed", () => {
    const { narration, advance, shown } = narrating();
    const lines = [line("a", 1)];
    narration.narrate(lines);
    lines[0]!.points = 99;
    advance(20);
    expect(shown()).toBe(1);
    expect(unitMs).toBeCloseTo(66.667, 3);
  });
});
