import { describe, expect, it } from "vite-plus/test";
import { profilerExport, sortedByCost } from "./export";
import type { CaseResult, RunResult, SampleSet } from "./runner";

const set = (gpu: number | null, cpu: number): SampleSet => ({
  objects: 25,
  gpu: gpu === null ? null : { median: gpu, p95: gpu, samples: 10 },
  cpu: { median: cpu, p95: cpu, samples: 10 },
  frame: { median: 16, p95: 17, samples: 10 },
  counts: { calls: 1, triangles: 12, geometries: 1, textures: 0, programs: 1 },
  gpuRejected: 0,
});
const result = (id: string, gpu: number | null, cpu: number): CaseResult => ({
  id,
  family: "test",
  label: id,
  unit: { kind: "group", size: 4 },
  sampling: "steady",
  host: "board",
  baseline: set(gpu === null ? null : 0.1, 0.1),
  counts: [1, 10, 50].map((count) => ({
    count,
    framing: { gridSide: Math.ceil(Math.sqrt(count)), cameraDistance: 5, fov: 40 },
    creation: { build: count, firstFrame: 2 },
    set: set(gpu === null ? null : gpu * count, cpu * count),
    relative: { gpu, cpu },
  })),
  leaked: { geometries: 0, textures: 0 },
});

describe("profiler export (#619)", () => {
  it("sorts by the chosen cost, highest first, with missing GPU time last", () => {
    const results = [result("a", 1, 5), result("b", null, 9), result("c", 3, 1)];
    expect(sortedByCost(results, "gpu").map(({ id }) => id)).toEqual(["c", "a", "b"]);
    expect(sortedByCost(results, "cpu").map(({ id }) => id)).toEqual(["b", "a", "c"]);
  });

  it("exports identity, environment, method, timing availability and coverage as JSON", () => {
    const run: RunResult = {
      results: [result("a", null, 2)],
      cancelled: false,
      failures: [{ id: "b", kind: "timeout", reason: "exceeded 120000 ms" }],
      aborted: null,
      notRun: [],
      gpuTiming: "unavailable",
      invalidated: [],
    };
    const exported = profilerExport(
      run,
      {
        frames: 120,
        warmupFrames: 30,
        seed: 527,
        counts: [1, 10, 50],
        signal: new AbortController().signal,
      },
      {
        userAgent: "test",
        gpu: null,
        width: 1280,
        height: 720,
        pixelRatio: 1.5,
        quality: "standard",
      },
      {
        catalogs: [
          {
            catalog: "material",
            installed: true,
            expected: 2,
            available: 1,
            unsupported: [],
            uncovered: ["material:steel"],
          },
          {
            catalog: "rack item",
            installed: false,
            expected: 0,
            available: 0,
            unsupported: [],
            uncovered: [],
          },
        ],
        totals: { expected: 2, available: 1, unsupported: 0, uncovered: 1 },
        complete: false,
      },
      new Date("2026-11-12T00:00:00Z"),
    );
    const round = JSON.parse(JSON.stringify(exported));
    expect(round.options).toEqual({
      frames: 120,
      warmupFrames: 30,
      seed: 527,
      counts: [1, 10, 50],
    });
    expect(round.gpuTiming).toBe("unavailable");
    expect(round.results[0].counts.map(({ set }: { set: { gpu: unknown } }) => set.gpu)).toEqual([
      null,
      null,
      null,
    ]);
    expect(round.uncovered).toEqual([{ family: "material", missing: ["material:steel"] }]);
    expect(round.coverage.complete).toBe(false);
    expect(round.results[0].unit).toEqual({ kind: "group", size: 4 });
    expect(round.coverage.catalogs[1]).toMatchObject({ catalog: "rack item", installed: false });
    expect(round.method.version).toBe(2);
    // No isolation stated: the default is the honest one, that frames may have been shared.
    expect(round.isolation).toBe("shared");
    expect(round.failures).toEqual([{ id: "b", kind: "timeout", reason: "exceeded 120000 ms" }]);
    expect(round.exportedAt).toBe("2026-11-12T00:00:00.000Z");
  });
});

describe("export schema versions (#721)", () => {
  it("reads version 2, recognises version 1 as old results, and refuses anything else", async () => {
    const { readProfilerExport } = await import("./export");
    const current = JSON.stringify({ method: { version: 2 }, results: [] });
    expect(readProfilerExport(current).kind).toBe("current");
    const old = JSON.stringify({ method: { version: 1 }, results: [{ collection: {} }] });
    expect(readProfilerExport(old)).toEqual({ kind: "legacy", version: 1 });
    expect(() => readProfilerExport(JSON.stringify({ method: { version: 9 } }))).toThrow(
      /version: 9/,
    );
  });

  it("ranks by the largest count, missing GPU time last", async () => {
    const { sortedByCost } = await import("./export");
    const ranked = sortedByCost(
      [result("small", 1, 1), result("none", null, 9), result("big", 3, 1)],
      "gpu",
    );
    expect(ranked.map(({ id }) => id)).toEqual(["big", "small", "none"]);
  });
});

describe("isolation in the exported record (#735 review)", () => {
  it("keeps whether the application's rendering was paused", async () => {
    const { profilerExport } = await import("./export");
    const run = {
      results: [],
      failures: [],
      aborted: null,
      notRun: [],
      cancelled: false,
      gpuTiming: "unavailable" as const,
      invalidated: [],
    };
    const coverage = {
      catalogs: [],
      totals: { expected: 0, available: 0, unsupported: 0, uncovered: 0 },
      complete: false,
    };
    const environment = {
      userAgent: "test",
      gpu: null,
      width: 1,
      height: 1,
      pixelRatio: 1,
      quality: "standard",
    };
    const options = { frames: 10, warmupFrames: 3, seed: 1 };
    expect(profilerExport(run, options, environment, coverage, undefined, "paused").isolation).toBe(
      "paused",
    );
    expect(
      JSON.parse(JSON.stringify(profilerExport(run, options, environment, coverage))).isolation,
    ).toBe("shared");
  });
});
