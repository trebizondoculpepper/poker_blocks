import { describe, expect, it, vi } from "vite-plus/test";
import { createActionPhases, phaseProducers, type Reservation } from "./action-phases";
import {
  createVisualScheduler,
  unitMs,
  visualFallbacks,
  visualHandlers,
  type EffectHandle,
} from "./scheduler";

/** What ran, and when: `${label}@${ms}` at start and `${label}!` at finish. */
const trace: string[] = [];
visualHandlers.register("test.phaseWork", (payload, context): EffectHandle => {
  const { label, ms } = payload as { label: string; ms: number };
  const started = context.nowMs;
  trace.push(`${label}@${Math.round(started)}`);
  return {
    update: (now) => {
      if (now - started < ms) return "running";
      trace.push(`${label}!`);
      return "finished";
    },
    cancel: () => void trace.push(`${label}x`),
    dispose: () => {},
  };
});
const summaries: unknown[] = [];
visualFallbacks.register("test.phaseSummary", ({ payload }) => void summaries.push(payload));

let producerCount = 0;
/** Register a controlled producer reserving `reservation` for every action. */
function producer(reservation: Reservation | ((captured: unknown) => Reservation)) {
  const name = `test.producer.${++producerCount}`;
  phaseProducers.register(name, {
    reserve: (captured) =>
      typeof reservation === "function" ? reservation(captured) : reservation,
  });
  return name;
}

const work = (label: string, ms: number) => ({
  handler: "test.phaseWork",
  payload: { label, ms },
  dueUnits: 0,
});

function harness(
  producers: string[],
  options: { bindLimitUnits?: number; maxRecords?: number } = {},
) {
  trace.length = 0;
  summaries.length = 0;
  const scheduler = createVisualScheduler();
  let now = 0;
  const step = (ms: number) => {
    for (let t = 0; t < ms; t += 10) scheduler.update((now += 10), true);
  };
  scheduler.update(0, true);
  const phases = createActionPhases(scheduler, {
    plan: "scoring",
    producers,
    fallback: "test.phaseSummary",
    ...options,
  });
  return { scheduler, phases, step };
}

describe("action-correlated presentation phases (#1218; doc/action-presentation-phases.md)", () => {
  it("runs post-scoring only after that action's scoring, whatever the registration order", () => {
    const graph = producer({ slot: "postScoring" });
    const narration = producer({ slot: "scoring" });
    const flight = producer({ slot: "preScoring" });
    // Graph registered first: it still can't run, or let the action settle, before scoring.
    const { phases, step } = harness([graph, narration, flight]);
    const committed = phases.commit("a1", { score: 40 });
    if (!committed.ok) throw new Error(committed.diagnostic);
    const c = committed.contributions;
    c.get(graph)!.bind(work("graph", 40));
    c.get(flight)!.bind(work("flight", 100));
    step(50);
    c.get(narration)!.bind(work("narration", 100));
    step(400);
    expect(trace.map((t) => t.replace(/@\d+/, ""))).toEqual([
      "flight",
      "flight!",
      "narration",
      "narration!",
      "graph",
      "graph!",
    ]);
    // Graph started after narration finished.
    const at = (label: string) =>
      Number(trace.find((t) => t.startsWith(`${label}@`))!.split("@")[1]);
    expect(at("graph")).toBeGreaterThanOrEqual(at("narration") + 100);
    expect(phases.status(committed.key)).toEqual({ state: "finished" });
  });

  it("keeps the action open while any reserved contribution is unbound", () => {
    const graph = producer({ slot: "postScoring" });
    const narration = producer({ slot: "scoring" });
    const { phases, step } = harness([narration, graph]);
    const committed = phases.commit("a1", null);
    if (!committed.ok) throw new Error(committed.diagnostic);
    committed.contributions.get(narration)!.bind(work("narration", 20));
    step(200);
    // Scoring finished; the graph's reservation still holds the action open.
    expect(phases.status(committed.key, "scoring")).toEqual({ state: "finished" });
    expect(phases.status(committed.key)).toEqual({ state: "pending" });
    committed.contributions.get(graph)!.settleEmpty();
    step(20);
    expect(phases.status(committed.key)).toEqual({ state: "finished" });
  });

  it("gives a zero-score action an explicit scoring completion", () => {
    const narration = producer((captured) =>
      (captured as { lines: number }).lines > 0 ? { slot: "scoring" } : null,
    );
    const graph = producer({ slot: "postScoring" });
    const { phases, step } = harness([narration, graph]);
    const committed = phases.commit("zero", { lines: 0 });
    if (!committed.ok) throw new Error(committed.diagnostic);
    expect(committed.contributions.has(narration)).toBe(false);
    committed.contributions.get(graph)!.bind(work("graph", 10));
    step(50);
    expect(phases.status(committed.key, "scoring")).toEqual({ state: "finished" });
    expect(trace).toContain("graph!");
  });

  it("orders a chained contribution after the previous action's, without waiting for later narration", () => {
    const narration = producer({ slot: "scoring" });
    const graph = producer({ slot: "postScoring", ordered: "plot" });
    const { phases, step } = harness([narration, graph]);
    const first = phases.commit("a1", null);
    const second = phases.commit("a2", null);
    if (!first.ok || !second.ok) throw new Error("commit");
    // The second action narrates first; its graph still waits for the first action's graph.
    second.contributions.get(narration)!.bind(work("n2", 10));
    second.contributions.get(graph)!.bind(work("g2", 10));
    step(100);
    expect(trace.some((t) => t.startsWith("g2@"))).toBe(false);
    first.contributions.get(narration)!.bind(work("n1", 10));
    first.contributions.get(graph)!.bind(work("g1", 50));
    step(200);
    const order = trace.filter((t) => t.startsWith("g")).map((t) => t.replace(/@\d+/, ""));
    expect(order).toEqual(["g1", "g1!", "g2", "g2!"]);
  });

  it("fails an unbound reservation at its bound, running the summary once", () => {
    const graph = producer({ slot: "postScoring" });
    const { phases, step } = harness([graph], { bindLimitUnits: 3 });
    const committed = phases.commit("a1", { score: 7 });
    if (!committed.ok) throw new Error(committed.diagnostic);
    step(3 * unitMs + 50);
    expect(committed.contributions.get(graph)!.status().state).toBe("failed");
    expect(summaries).toEqual([{ producer: graph, captured: { score: 7 } }]);
    // A late bind changes nothing; the result isn't blocked.
    expect(committed.contributions.get(graph)!.bind(work("late", 10))).toBe(false);
    step(50);
    expect(phases.status(committed.key)).toEqual({ state: "finished" });
  });

  it("fails a producer's contribution once on its own failure", () => {
    const narration = producer({ slot: "scoring" });
    const { phases, step } = harness([narration]);
    const committed = phases.commit("a1", "x");
    if (!committed.ok) throw new Error(committed.diagnostic);
    const contribution = committed.contributions.get(narration)!;
    expect(contribution.fail("binder threw")).toBe(true);
    expect(contribution.fail("again")).toBe(false);
    step(20);
    expect(contribution.status()).toMatchObject({ state: "failed" });
    expect(summaries).toHaveLength(1);
  });

  it("cancels on reset without opening later phases, and old lookups are unavailable", () => {
    const narration = producer({ slot: "scoring" });
    const graph = producer({ slot: "postScoring" });
    const { phases, step } = harness([narration, graph]);
    const committed = phases.commit("a1", null);
    if (!committed.ok) throw new Error(committed.diagnostic);
    committed.contributions.get(narration)!.bind(work("narration", 100));
    committed.contributions.get(graph)!.bind(work("graph", 10));
    step(30);
    phases.reset();
    step(300);
    expect(trace).toContain("narrationx");
    expect(trace.some((t) => t.startsWith("graph@"))).toBe(false);
    expect(phases.status(committed.key)).toBe("unavailable");
    expect(phases.contribution(committed.key, graph)).toBeNull();
    expect(phases.observe(committed.key, null, vi.fn())).toBeNull();
    // The new generation starts fresh, and the same action id is a new record.
    expect(phases.commit("a1", null).ok).toBe(true);
  });

  it("rejects a duplicate commit and bounds its records", () => {
    const narration = producer({ slot: "scoring" });
    const { phases } = harness([narration], { maxRecords: 2 });
    expect(phases.commit("a1", null).ok).toBe(true);
    expect(phases.commit("a1", null)).toEqual({
      ok: false,
      diagnostic: "action a1 already recorded",
    });
    expect(phases.commit("a2", null).ok).toBe(true);
    // Both still pending: nothing to evict.
    expect(phases.commit("a3", null)).toEqual({
      ok: false,
      diagnostic: "action record limit 2 reached",
    });
  });

  it("reports observation of a phase settling, once", () => {
    const narration = producer({ slot: "scoring" });
    const { phases, step } = harness([narration]);
    const committed = phases.commit("a1", null);
    if (!committed.ok) throw new Error(committed.diagnostic);
    const seen = vi.fn();
    phases.observe(committed.key, "scoring", seen);
    committed.contributions.get(narration)!.bind(work("n", 10));
    step(100);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith({ state: "finished" });
  });

  it("keeps every earlier slot as a barrier when a middle slot is empty (#1251)", () => {
    const flight = producer({ slot: "preScoring" });
    const graph = producer({ slot: "postScoring" });
    // No scoring contribution at all.
    const { phases, step } = harness([flight, graph]);
    const committed = phases.commit("a1", null);
    if (!committed.ok) throw new Error(committed.diagnostic);
    committed.contributions.get(graph)!.bind(work("graph", 10));
    committed.contributions.get(flight)!.bind(work("flight", 100));
    step(300);
    const at = (label: string) =>
      Number(trace.find((t) => t.startsWith(`${label}@`))!.split("@")[1]);
    expect(at("graph")).toBeGreaterThanOrEqual(at("flight") + 100);
  });

  it("starts bound work when its gates open, not when its hold started (#1251)", () => {
    const narration = producer({ slot: "scoring" });
    const graph = producer({ slot: "postScoring" });
    const { phases, step } = harness([narration, graph]);
    const committed = phases.commit("a1", null);
    if (!committed.ok) throw new Error(committed.diagnostic);
    committed.contributions.get(graph)!.bind(work("graph", 30));
    step(200);
    committed.contributions.get(narration)!.bind(work("narration", 10));
    step(200);
    // The graph started after narration and still ran its full 30 ms.
    const started = Number(trace.find((t) => t.startsWith("graph@"))!.split("@")[1]);
    expect(started).toBeGreaterThanOrEqual(210);
    expect(trace).toContain("graph!");
  });

  it("contains a throwing producer and still closes the collection (#1251)", () => {
    const throwing = `test.producer.${++producerCount}`;
    phaseProducers.register(throwing, {
      reserve: () => {
        throw new Error("boom");
      },
    });
    const narration = producer({ slot: "scoring" });
    const { phases, step } = harness([throwing, narration]);
    const committed = phases.commit("a1", { score: 1 });
    if (!committed.ok) throw new Error(committed.diagnostic);
    expect(committed.diagnostics).toEqual([`${throwing}: reserve failed: boom`]);
    expect(summaries).toEqual([{ producer: throwing, captured: { score: 1 } }]);
    committed.contributions.get(narration)!.bind(work("n", 10));
    step(100);
    expect(phases.status(committed.key)).toEqual({ state: "finished" });
  });

  it("summarises and cancels a reservation the scheduler won't admit (#1251)", () => {
    const narration = producer({ slot: "scoring" });
    trace.length = 0;
    summaries.length = 0;
    const scheduler = createVisualScheduler({ limits: { pendingGlobal: 1 } });
    scheduler.update(0, true);
    // Fill the only pending place.
    const filler = scheduler.createScope(null);
    scheduler.schedule(filler, work("filler", 10_000));
    const phases = createActionPhases(scheduler, {
      plan: "scoring",
      producers: [narration],
      fallback: "test.phaseSummary",
    });
    const committed = phases.commit("a1", "x");
    if (!committed.ok) throw new Error(committed.diagnostic);
    expect(committed.diagnostics[0]).toContain("reservation not admitted");
    expect(summaries).toHaveLength(1);
    const contribution = committed.contributions.get(narration)!;
    expect(contribution.status().state).toBe("cancelled");
    expect(contribution.bind(work("late", 10))).toBe(false);
  });

  it("gives direct summaries the scheduler's services and contains their throws (#1255)", async () => {
    const seen: unknown[] = [];
    visualFallbacks.register("test.servicesSummary", ({ services }) => {
      seen.push(services);
      throw new Error("summary broke");
    });
    const throwing = `test.producer.${++producerCount}`;
    phaseProducers.register(throwing, {
      reserve: () => {
        throw new Error("boom");
      },
    });
    const narration = producer({ slot: "scoring" });
    const services = { summarySink: "sink" };
    const scheduler = createVisualScheduler({ services });
    scheduler.update(0, true);
    const phases = createActionPhases(scheduler, {
      plan: "scoring",
      producers: [throwing, narration],
      fallback: "test.servicesSummary",
      services,
    });
    const reported = new Promise<unknown>((resolve) => {
      const previous = globalThis.queueMicrotask;
      globalThis.queueMicrotask = (callback) =>
        previous(() => {
          try {
            callback();
          } catch (error) {
            resolve(error);
          } finally {
            globalThis.queueMicrotask = previous;
          }
        });
    });
    const committed = phases.commit("a1", null);
    if (!committed.ok) throw new Error(committed.diagnostic);
    expect(seen).toEqual([services]);
    expect(committed.diagnostics).toContain(`${throwing}: summary failed: summary broke`);
    expect(committed.contributions.has(narration)).toBe(true);
    expect(((await reported) as Error).message).toBe("summary broke");
  });

  it("lets its owner observe a contribution's terminal status once (#1280)", () => {
    const narration = producer({ slot: "scoring" });
    const graph = producer({ slot: "postScoring" });
    const { phases, step } = harness([narration, graph]);
    const committed = phases.commit("a1", null);
    if (!committed.ok) throw new Error(committed.diagnostic);
    const failing = vi.fn();
    const landing = vi.fn();
    committed.contributions.get(graph)!.observe(failing);
    committed.contributions.get(narration)!.observe(landing);
    committed.contributions.get(narration)!.bind(work("n", 10));
    committed.contributions.get(graph)!.fail("bound work not admitted");
    step(100);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(failing.mock.calls[0]![0]).toMatchObject({ state: "failed" });
    expect(landing).toHaveBeenCalledTimes(1);
    expect(landing.mock.calls[0]![0]).toEqual({ state: "finished" });
  });
});
