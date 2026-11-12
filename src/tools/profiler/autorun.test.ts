import { describe, expect, it } from "vite-plus/test";
import {
  createDevProfilerScope,
  profilerResultSinks,
  type SweepDelivery,
  type SweepHost,
  type SweepRequest,
} from "./autorun";

type Record = { finished: boolean; request: SweepRequest };

/** A host whose sweeps finish when told to, or end partial when their signal fires. */
function fakeHost(isolation = true) {
  const pending: { request: SweepRequest; finish: () => void }[] = [];
  let isolated = 0;
  const host: SweepHost<Record> = {
    sweep: (request, signal) =>
      new Promise<Record>((resolve) => {
        const finish = () => resolve({ finished: true, request });
        signal.addEventListener("abort", () => resolve({ finished: false, request }), {
          once: true,
        });
        pending.push({ request, finish });
      }),
    ...(isolation
      ? {
          isolate: () => {
            isolated++;
            return () => {
              isolated--;
            };
          },
        }
      : {}),
  };
  return { host, pending, isolatedNow: () => isolated };
}

/** A sink registered by the test: a second room's own way of receiving results. */
const received: SweepDelivery<Record>[] = [];
if (!profilerResultSinks.has("test.collect"))
  profilerResultSinks.register("test.collect", () => (delivery) => {
    received.push(delivery as SweepDelivery<Record>);
  });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the devProfiler trait's run scope (#732)", () => {
  it("runs on entry with its captured settings and delivers once to its configured sinks", async () => {
    received.length = 0;
    const { host, pending, isolatedNow } = fakeHost();
    const scope = createDevProfilerScope(host, null);
    void scope.enter({ catalogs: ["material"], counts: [1, 10, 50], sinks: ["test.collect"] });
    await settle();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.request).toMatchObject({ catalogs: ["material"], counts: [1, 10, 50] });
    expect(isolatedNow()).toBe(1);
    pending[0]!.finish();
    await settle();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ partial: false, isolated: true });
    expect(isolatedNow()).toBe(0);
  });

  it("composes into a second room with its own config and sinks, without auto-run", async () => {
    received.length = 0;
    const { host, pending } = fakeHost(false);
    const scope = createDevProfilerScope(host, { room: "second" });
    await scope.enter({ autoRun: false, sinks: ["test.collect"], counts: [2] });
    expect(pending).toHaveLength(0);
    void scope.rerun();
    await settle();
    expect(pending[0]!.request.counts).toEqual([2]);
    pending[0]!.finish();
    await settle();
    // No isolation capability: the record says so rather than claiming clean frames.
    expect(received).toEqual([expect.objectContaining({ partial: false, isolated: false })]);
  });

  it("delivers a partial record once when the room is left mid-run", async () => {
    received.length = 0;
    const { host, pending } = fakeHost();
    const scope = createDevProfilerScope(host, null);
    void scope.enter({ sinks: ["test.collect"] });
    await settle();
    await scope.exit();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ partial: true });
    // A late finish after exit changes nothing.
    pending[0]!.finish();
    await settle();
    expect(received).toHaveLength(1);
  });

  it("cancels and settles the previous run before a rerun starts", async () => {
    received.length = 0;
    const { host, pending } = fakeHost();
    const scope = createDevProfilerScope(host, null);
    void scope.enter({ sinks: ["test.collect"] });
    await settle();
    void scope.rerun();
    await settle();
    expect(pending).toHaveLength(2);
    // The first run ended partial before the second began; only the second can finish.
    expect(received.map(({ partial }) => partial)).toEqual([true]);
    pending[1]!.finish();
    await settle();
    expect(received.map(({ partial }) => partial)).toEqual([true, false]);
  });

  it("never lets an earlier entry's late record reach a later entry's sinks", async () => {
    const earlier: SweepDelivery<Record>[] = [];
    const later: SweepDelivery<Record>[] = [];
    let target = earlier;
    if (!profilerResultSinks.has("test.per-entry"))
      profilerResultSinks.register("test.per-entry", () => {
        const into = target;
        return (delivery) => void into.push(delivery as SweepDelivery<Record>);
      });
    const { host, pending } = fakeHost();
    const scope = createDevProfilerScope(host, null);
    void scope.enter({ sinks: ["test.per-entry"] });
    await settle();
    const leaving = scope.exit();
    target = later;
    void scope.enter({ sinks: ["test.per-entry"] });
    await leaving;
    await settle();
    expect(earlier.map(({ partial }) => partial)).toEqual([true]);
    expect(later).toEqual([]);
    pending.at(-1)!.finish();
    await settle();
    expect(later.map(({ partial, generation }) => [partial, generation])).toEqual([
      [false, scope.generation],
    ]);
  });

  it("starts nothing when entered and left before the previous run settles", async () => {
    received.length = 0;
    const { host, pending } = fakeHost();
    const scope = createDevProfilerScope(host, null);
    void scope.enter({ sinks: ["test.collect"] });
    await settle();
    void scope.rerun();
    await scope.exit();
    await settle();
    expect(pending).toHaveLength(1);
  });
});

describe("a record the host reports as partial (#732)", () => {
  it("is delivered as partial even though the trait did not cancel it", async () => {
    received.length = 0;
    const host: SweepHost<Record> = {
      sweep: async (request) => ({ finished: false, request }),
      partial: (record) => !record.finished,
    };
    const scope = createDevProfilerScope(host, null);
    await scope.enter({ sinks: ["test.collect"] });
    expect(received.map(({ partial }) => partial)).toEqual([true]);
  });
});
