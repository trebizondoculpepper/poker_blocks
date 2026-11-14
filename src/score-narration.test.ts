import { describe, expect, it } from "vite-plus/test";
import type { RoundOutcome } from "./dealer";
import {
  createScoreNarration,
  type NarratedEndpoint,
  type NarratedLine,
  type NarratedPlay,
} from "./score-narration";
import { createVisualScheduler, unitMs } from "./visual-events/scheduler";

const line = (id: string, points: number): NarratedLine => ({
  blockIds: [id],
  sourceIds: [`source-${id}`],
  points,
});

/** A committed play: its lines and the endpoint it captured. */
const play = (lines: readonly NarratedLine[], score = 0): NarratedPlay => ({
  lines,
  endpoint: { score, outcome: "playing" as RoundOutcome },
});

/** A real scheduler on injected time, narrating into a log. */
function narrating(limits: Parameters<typeof createVisualScheduler>[0] = {}) {
  const log: string[] = [];
  const endpoints: string[] = [];
  const lates: number[] = [];
  let shown = 0;
  const sink = {
    line(entry: NarratedLine, lateMs: number) {
      shown += entry.points;
      lates.push(lateMs);
      log.push(`${Math.round(scheduler.nowMs)}:line ${entry.blockIds.join()}`);
    },
    summarise({ score }: NarratedEndpoint) {
      endpoints.push(`summary ${score}`);
      log.push(`${Math.round(scheduler.nowMs)}:summary`);
    },
    decide({ score, outcome }: NarratedEndpoint) {
      endpoints.push(`outcome ${score} ${outcome}`);
      log.push(`${Math.round(scheduler.nowMs)}:outcome`);
    },
  };
  const scheduler = createVisualScheduler({ ...limits, services: { scoreNarration: sink } });
  // 2 units between lines, 6 units to settle: 133⅓ ms and 400 ms.
  let idles = 0;
  const narration = createScoreNarration(
    scheduler,
    sink,
    { lineStep: 2, settle: 6 },
    () => idles++,
  );
  let real = 1000;
  scheduler.update(real, true);
  const advance = (ms: number, step = 10) => {
    for (let t = 0; t < ms; t += step) scheduler.update((real += step), true);
  };
  return {
    log,
    endpoints,
    narration,
    scheduler,
    advance,
    shown: () => shown,
    idles: () => idles,
    lates,
  };
}

describe("score narration on the visual-event scheduler (#547)", () => {
  it("shows a play's lines one step apart, then the outcome once the last tint settles", () => {
    const { log, narration, advance, shown } = narrating();
    narration.narrate(play([line("a", 10), line("b", 20)]));
    expect(narration.presenting).toBe(true);
    advance(1000);
    // Lines at 0 and 2 units; the outcome 6 units after the last line.
    expect(log).toEqual(["10:line a", "140:line b", "540:outcome"]);
    expect(shown()).toBe(30);
    expect(narration.presenting).toBe(false);
  });

  it("narrates a later play after the earlier play's scope settles, and announces once", () => {
    const { log, narration, advance } = narrating();
    narration.narrate(play([line("a", 1), line("b", 1)]));
    advance(50);
    // Committed while play 1 narrates: its lines were captured now, and wait their turn.
    narration.narrate(play([line("c", 1)]));
    advance(1000);
    // Play 1's scope settles a step after its last line (≈267 ms); play 2 starts then.
    expect(log).toEqual(["10:line a", "140:line b", "270:line c", "670:outcome"]);
  });

  it("cancels a pending outcome when another play commits before it shows", () => {
    const { log, narration, advance } = narrating();
    narration.narrate(play([line("a", 1)]));
    advance(300);
    narration.narrate(play([line("b", 1)]));
    advance(1000);
    expect(log.filter((entry) => entry.endsWith("outcome"))).toHaveLength(1);
    expect(log.at(-1)).toMatch(/outcome$/);
    expect(log.indexOf(log.find((entry) => entry.endsWith("line b"))!)).toBeLessThan(
      log.length - 1,
    );
  });

  it("announces at once after a play that scores nothing", () => {
    const { log, narration, advance } = narrating();
    narration.narrate(play([]));
    advance(20);
    expect(log).toEqual(["10:outcome"]);
  });

  it("shows nothing more after a reset, and leaves no scope or event behind", () => {
    const { log, narration, advance, scheduler } = narrating();
    narration.narrate(play([line("a", 1), line("b", 1)]));
    narration.narrate(play([line("c", 1)]));
    advance(20);
    narration.reset();
    advance(1000);
    expect(log).toEqual(["10:line a"]);
    expect(narration.presenting).toBe(false);
    expect(scheduler.counts).toMatchObject({ pending: 0, active: 0, heap: 0, entries: 0 });
  });

  it("summarises and still announces when a play's lines can't be admitted", () => {
    const { log, narration, advance } = narrating({ limits: { pendingPerScope: 1 } });
    narration.narrate(play([line("a", 1), line("b", 1)]));
    advance(20);
    expect(log).toEqual(["0:summary", "10:outcome"]);
  });

  it("holds narration while the page is hidden, and resumes where it stopped", () => {
    const { log, narration, scheduler } = narrating();
    narration.narrate(play([line("a", 1), line("b", 1)]));
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
    narration.narrate(play(lines));
    lines[0]!.points = 99;
    advance(20);
    expect(shown()).toBe(1);
    expect(unitMs).toBeCloseTo(66.667, 3);
  });

  it("announces the captured endpoint of the last play, never live state (#800 review)", () => {
    const { endpoints, narration, advance } = narrating();
    narration.narrate({ lines: [line("a", 1)], endpoint: { score: 10, outcome: "playing" } });
    narration.narrate({ lines: [line("b", 1)], endpoint: { score: 30, outcome: "won" } });
    advance(1000);
    expect(endpoints).toEqual(["outcome 30 won"]);
  });

  it("summarises a failed play with the score it captured", () => {
    const { endpoints, narration, advance } = narrating({ limits: { pendingPerScope: 1 } });
    narration.narrate({
      lines: [line("a", 1), line("b", 1)],
      endpoint: { score: 7, outcome: "lost" },
    });
    advance(20);
    expect(endpoints).toEqual(["summary 7", "outcome 7 lost"]);
  });

  it("excludes a hidden interval the browser sent no frames for (#800 review)", () => {
    const { log, narration, scheduler } = narrating();
    narration.narrate(play([line("a", 1), line("b", 1)]));
    scheduler.update(1010, true);
    scheduler.suspend(); // hidden: no frames arrive
    scheduler.suspend(); // visible again
    scheduler.update(60_000, true);
    scheduler.update(60_100, true);
    expect(log).toEqual(["10:line a"]);
    scheduler.update(60_140, true);
    expect(log).toEqual(["10:line a", "150:line b"]);
  });

  it("drops a failed play's remaining lines once its summary shows (#800 review)", () => {
    const { log, endpoints, narration, advance, shown } = narrating({
      limits: { maxEffectMs: 50 },
    });
    narration.narrate({
      lines: [line("a", 1), line("b", 1), line("c", 1)],
      endpoint: { score: 3, outcome: "playing" },
    });
    // One frame stalls past the effect limit while line a is active.
    advance(10);
    advance(500, 500);
    advance(1000);
    expect(endpoints).toEqual(["summary 3", "outcome 3 playing"]);
    expect(log.filter((entry) => entry.includes("line"))).toEqual(["10:line a"]);
    expect(shown()).toBe(1);
  });

  it("narrates in committed order even when a later play is ready first (#800 review)", () => {
    const { log, endpoints, narration, advance } = narrating();
    const first = narration.reserve();
    const second = narration.reserve();
    narration.release(second, { lines: [line("b", 1)], endpoint: { score: 2, outcome: "won" } });
    advance(500);
    expect(log).toEqual([]);
    narration.release(first, { lines: [line("a", 1)], endpoint: { score: 1, outcome: "playing" } });
    advance(1000);
    expect(log.filter((entry) => entry.includes("line"))).toEqual(["510:line a", "640:line b"]);
    expect(endpoints).toEqual(["outcome 2 won"]);
  });

  it("reports idle once the outcome has settled, when presenting is false (#800 review)", () => {
    const { narration, advance, idles } = narrating();
    narration.narrate(play([line("a", 1)]));
    advance(1000);
    expect(narration.presenting).toBe(false);
    expect(idles()).toBe(1);
  });

  it("keeps the last tint's settle time across an empty play (#800 review)", () => {
    const { log, narration, advance } = narrating();
    narration.narrate(play([line("a", 1)]));
    narration.narrate(play([]));
    advance(1000);
    // Line a was due at 0 ms; its tint settles 6 units (400 ms) later, empty play or not.
    expect(log).toEqual(["10:line a", "400:outcome"]);
  });

  it("tells a line how late it started, so its visuals keep the scope's clock (#800 review)", () => {
    const { narration, scheduler, lates } = narrating();
    narration.narrate(play([line("a", 1)]));
    scheduler.update(2000, true); // a one-second stall before the line dispatches
    expect(lates).toEqual([1000]);
  });

  it("doesn't let a reset play's tint tail hold up a later empty play (#999)", () => {
    const { log, narration, advance } = narrating();
    narration.narrate(play([line("old", 1)]));
    advance(10);
    narration.reset();
    log.length = 0;
    narration.narrate(play([], 0));
    advance(20);
    // Announced on the next dispatch, not 400 ms later for the cancelled line's tint.
    expect(log).toEqual(["20:outcome"]);
    expect(narration.presenting).toBe(false);
  });

  it("keeps the earlier tint tail when an empty play follows a scored one (#999)", () => {
    const { log, narration, advance } = narrating();
    narration.narrate(play([line("a", 1)]));
    advance(200);
    narration.narrate(play([]));
    advance(1000);
    expect(log).toEqual(["10:line a", "400:outcome"]);
  });

  it("lets the next play's lines keep pace while an earlier tail holds the outcome (#999)", () => {
    const { log, narration, advance } = narrating();
    narration.narrate(play([line("a", 1)]));
    narration.narrate(play([line("b", 1)]));
    advance(1000);
    expect(log).toEqual(["10:line a", "140:line b", "540:outcome"]);
  });

  it("releases every scope after repeated resets (#999)", () => {
    const { narration, scheduler, advance } = narrating();
    for (let round = 0; round < 3; round++) {
      narration.narrate(play([line("a", 1), line("b", 1)]));
      advance(50);
      narration.reset();
    }
    advance(1000);
    expect(narration.presenting).toBe(false);
    expect(scheduler.counts).toMatchObject({ pending: 0, active: 0, heap: 0, entries: 0 });
  });
});
