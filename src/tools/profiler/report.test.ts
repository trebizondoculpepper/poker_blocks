import { describe, expect, it } from "vite-plus/test";
import type { ProfilerExport } from "./export";
import { profilerReport, rendererKind } from "./report";
import type { CaseResult, SampleSet } from "./runner";

const set = (objects: number, gpu: number | null, cpu: number, calls = objects): SampleSet => ({
  objects,
  gpu: gpu === null ? null : { median: gpu, p95: gpu * 1.5, samples: 10 },
  cpu: { median: cpu, p95: cpu * 2, samples: 10 },
  frame: { median: 16, p95: 18, samples: 10 },
  counts: { calls, triangles: objects * 12, geometries: 1, textures: 0, programs: 1 },
  gpuRejected: 0,
});

/** A case measured at 1, 10 and 50, costing `perObject` per object (GPU null when unknown). */
const result = (
  id: string,
  perObject: number | null,
  cpu: number,
  kind: "block" | "group" | "emitter" = "block",
): CaseResult => ({
  id,
  family: "test",
  label: id,
  unit: { kind, size: 1 },
  sampling: "steady",
  host: "board",
  baseline: set(0, perObject === null ? null : 0.1, 0.1, 0),
  counts: [1, 10, 50].map((count) => ({
    count,
    framing: { gridSide: Math.ceil(Math.sqrt(count)), cameraDistance: 5, fov: 40 },
    creation: { build: count, firstFrame: 1 },
    set: set(count, perObject === null ? null : perObject * count, cpu * count),
    relative: { gpu: perObject === null ? null : perObject * count - 0.1, cpu: cpu * count - 0.1 },
  })),
  leaked: { geometries: 0, textures: 0 },
});

const record = (
  results: CaseResult[],
  overrides: Partial<ProfilerExport> = {},
): ProfilerExport => ({
  exportedAt: "2026-11-12T00:00:00.000Z",
  method: { version: 2 } as ProfilerExport["method"],
  environment: {
    userAgent: "test",
    gpu: "Apple M3 Max",
    width: 1280,
    height: 720,
    pixelRatio: 1,
    quality: "standard",
  },
  options: { frames: 120, warmupFrames: 30, seed: 527, counts: [1, 10, 50] },
  gpuTiming: "available",
  cancelled: false,
  failures: [],
  aborted: null,
  notRun: [],
  invalidated: [],
  isolation: "paused",
  uncovered: [],
  coverage: {
    catalogs: [],
    totals: { expected: results.length, available: results.length, unsupported: 0, uncovered: 0 },
    complete: true,
  },
  results,
  ...overrides,
});

describe("the profiler report (#733)", () => {
  it("classifies the renderer from its WebGL string, and never guesses without one", () => {
    expect(rendererKind("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))")).toBe("software");
    expect(rendererKind("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe("software");
    expect(rendererKind("Apple M3 Max")).toBe("hardware");
    expect(rendererKind(null)).toBe("unknown");
  });

  it("ranks the 50-instance collections by valid GPU time, ties in catalog order, missing GPU left out", () => {
    const report = profilerReport(
      record([
        result("cheap", 0.01, 0.01),
        result("tieA", 0.05, 0.01),
        result("noGpu", null, 0.5),
        result("tieB", 0.05, 0.01),
      ]),
    );
    const gpu = report.rankings[0]!;
    expect(gpu.measure).toBe("gpu");
    expect(gpu.count).toBe(50);
    expect(gpu.entries.map(({ row }) => row.id)).toEqual(["tieA", "tieB", "cheap"]);
    expect(gpu.entries[0]).toMatchObject({ value: 2.5, p95: 3.75 });
    expect(gpu.entries[0]!.text).toBe("tieA: 2.500 ms (p95 3.750; vs baseline 2.400)");
    expect(report.rankings[2]!.entries[0]!.text).toMatch(/: 50 calls$/);
    expect(report.banner.summary).toMatch(
      /^Complete · renderer hardware · GPU timing valid · isolated/,
    );
    expect(report.rankings.map(({ measure }) => measure)).toEqual(["gpu", "cpu", "calls"]);
  });

  it("leads with an explicitly labelled CPU ranking when GPU timing is unavailable", () => {
    const report = profilerReport(
      record([result("a", null, 0.2), result("b", null, 0.1)], { gpuTiming: "unavailable" }),
    );
    expect(report.banner.gpuTiming).toBe("unavailable");
    expect(report.rankings[0]!.measure).toBe("cpu");
    expect(report.rankings[0]!.title).toMatch(/not GPU cost/);
    expect(report.rankings.some(({ measure }) => measure === "gpu")).toBe(false);
    expect(report.rows[0]!.gpu).toEqual([null, null, null]);
  });

  it("reports growth from the smallest to the largest count, and each count's values", () => {
    const [row] = profilerReport(record([result("a", 0.02, 0.1)])).rows;
    expect(row!.counts).toEqual([1, 10, 50]);
    expect(row!.calls).toEqual([1, 10, 50]);
    expect(row!.growth.gpu).toBeCloseTo(50);
    expect(row!.growth.cpu).toBeCloseTo(50);
  });

  it("states partial and error status, and an unisolated run, in the banner", () => {
    expect(profilerReport(record([result("a", 0.1, 0.1)])).banner.status).toBe("complete");
    const partial = profilerReport(
      record([result("a", 0.1, 0.1)], { cancelled: true, notRun: ["b"], isolation: "shared" }),
    );
    expect(partial.banner.status).toBe("partial");
    expect(partial.banner.notes).toEqual(
      expect.arrayContaining([
        "1 case(s) not run",
        "Not isolated: other rendering may have shared the frames",
      ]),
    );
    const failed = profilerReport(
      record([], { failures: [{ id: "x", kind: "timeout", reason: "exceeded 1 ms" }] }),
    );
    expect(failed.banner.status).toBe("errors");
    const uncovered = profilerReport(
      record([result("a", 0.1, 0.1)], {
        coverage: {
          catalogs: [],
          totals: { expected: 2, available: 1, unsupported: 0, uncovered: 1 },
          complete: false,
        },
      }),
    );
    expect(uncovered.banner.status).toBe("partial");
    expect(uncovered.banner.coverage).toBe(
      "1 of 2 expected cases available, 0 unsupported, 1 uncovered",
    );
  });

  it("summarises blocks apart from groups and emitters, in catalog order", () => {
    const report = profilerReport(
      record([result("b1", 0.1, 0.1), result("e1", 0.1, 0.1, "emitter"), result("b2", 0.1, 0.1)]),
    );
    expect(report.byUnit.map(({ kind, rows }) => [kind, rows.map(({ id }) => id)])).toEqual([
      ["block", ["b1", "b2"]],
      ["emitter", ["e1"]],
    ]);
  });
});

describe("a selected run never claims full coverage (#733)", () => {
  it("is partial when it measured fewer cases than the catalogs make available", () => {
    const report = profilerReport(
      record([result("a", 0.1, 0.1)], {
        coverage: {
          catalogs: [],
          totals: { expected: 162, available: 162, unsupported: 0, uncovered: 0 },
          complete: true,
        },
      }),
    );
    expect(report.banner.status).toBe("partial");
    expect(report.banner.summary).toMatch(/^Partial/);
    expect(report.banner.notes).toContain("Selected run: 1 of 162 available cases measured");
  });
});

describe("invalidated sets and growth (#741 review)", () => {
  it("leaves an invalidated set out of the rankings, withholds its growth, and marks the run partial", () => {
    const report = profilerReport(
      record([result("hidden", 0.5, 0.5), result("fine", 0.01, 0.01)], {
        invalidated: ["hidden/50"],
      }),
    );
    expect(report.rankings[0]!.entries.map(({ row }) => row.id)).toEqual(["fine"]);
    const hidden = report.rows.find(({ id }) => id === "hidden")!;
    expect(hidden.invalid).toEqual([false, false, true]);
    expect(hidden.growth).toEqual({ gpu: null, cpu: null });
    expect(report.banner.status).toBe("partial");
    expect(report.banner.notes.join(" ")).toMatch(/1 set\(s\) invalidated.*hidden\/50/);
  });

  it("withholds baseline-relative estimates when the baseline was invalidated", () => {
    const report = profilerReport(record([result("a", 0.1, 0.1)], { invalidated: ["a/baseline"] }));
    expect(report.rankings[0]!.entries[0]!.relative).toBeNull();
    expect(report.rankings[0]!.entries[0]!.text).toMatch(/vs baseline n\/a/);
  });

  it("states each case's growth from the smallest count to the largest", () => {
    const [row] = profilerReport(record([result("a", 0.02, 0.1)])).rows;
    expect(row!.growthText).toBe("a: GPU ×50.0, CPU ×50.0 (1 → 50)");
  });
});

describe("hosts and geometry (#741 review)", () => {
  it("names each ranked entry's host when cases were drawn in different hosts", () => {
    const hand = { ...result("held", 0.2, 0.1), host: "hand" };
    const report = profilerReport(record([result("board", 0.1, 0.1), hand]));
    expect(
      report.rankings[0]!.entries.map(
        ({ text }) => text.endsWith("]") && text.slice(text.lastIndexOf("[")),
      ),
    ).toEqual(["[host: hand]", "[host: board]"]);
    expect(report.banner.notes.join(" ")).toMatch(/2 different hosts \(board, hand\)/);
  });

  it("leaves entries unlabelled when every case shares one host", () => {
    const report = profilerReport(record([result("a", 0.1, 0.1), result("b", 0.2, 0.1)]));
    expect(report.rankings[0]!.entries.every(({ text }) => !text.includes("[host:"))).toBe(true);
  });

  it("keeps draw calls and triangles for every count on each row", () => {
    const [row] = profilerReport(record([result("a", 0.1, 0.1)])).rows;
    expect(row!.calls).toEqual([1, 10, 50]);
    expect(row!.triangles).toEqual([12, 120, 600]);
  });
});
