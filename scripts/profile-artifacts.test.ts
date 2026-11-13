import { describe, expect, it } from "vite-plus/test";
import type { ProfilerExport } from "../src/tools/profiler/export.ts";
import type { CaseResult, SampleSet } from "../src/tools/profiler/runner.ts";
import { exitCodeFor, reportCsv, reportHtml } from "./profile-artifacts.ts";

const set = (objects: number, gpu: number | null): SampleSet => ({
  objects,
  gpu: gpu === null ? null : { median: gpu, p95: gpu, samples: 10 },
  cpu: { median: objects / 10, p95: objects / 10, samples: 10 },
  frame: { median: 16, p95: 16, samples: 10 },
  counts: { calls: objects, triangles: objects * 12, geometries: 1, textures: 0, programs: 1 },
  gpuRejected: 0,
});
const result = (id: string, label = id): CaseResult => ({
  id,
  family: "material",
  label,
  unit: { kind: "block", size: 1 },
  sampling: "steady",
  host: "board",
  pipeline: { passes: [], passCount: 0, setup: 0 },
  baseline: set(0, 0.1),
  counts: [1, 10, 50].map((count) => ({
    count,
    framing: { gridSide: 1, cameraDistance: 5, fov: 40 },
    creation: { build: 1, firstFrame: 1 },
    set: set(count, count / 100),
    relative: { gpu: count / 100, cpu: count / 10 },
  })),
  leaked: { geometries: 0, textures: 0 },
});
const record = (
  results: CaseResult[],
  overrides: Partial<ProfilerExport> = {},
): ProfilerExport => ({
  exportedAt: "2026-11-12T00:00:00.000Z",
  method: { version: 3 } as ProfilerExport["method"],
  environment: {
    userAgent: "t",
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
const provenance = {
  revision: "abc1234",
  command: "scripts/profile.ts",
  startedAt: "2026-11-12T00:00:00Z",
};

describe("the one-command run's artifacts (#734)", () => {
  it("writes one CSV line per case and count, quoting awkward labels", () => {
    const csv = reportCsv(record([result("a", 'Steel, "brushed"')]));
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(
      "case,label,phase,family,host,pipeline,unit,unit_size,count,invalid,gpu_median_ms,gpu_p95_ms,cpu_median_ms,draw_calls,triangles,leaked",
    );
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe(
      'a,"Steel, ""brushed""",,material,board,main render,block,1,50,,0.5,0.5,5,50,600,',
    );
  });

  it("builds a self-contained HTML page with the banner, provenance and every case, escaped", () => {
    const html = reportHtml(record([result("a", "<b>bold</b>")]), provenance);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("Complete · renderer hardware · GPU timing valid · isolated");
    expect(html).toContain("Revision abc1234");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).not.toContain("<b>bold</b>");
    // Self-contained: no external scripts or stylesheets.
    expect(html).not.toMatch(/<script|<link/);
  });

  it("exits 0 only for a complete run", () => {
    expect(exitCodeFor(record([result("a")]))).toBe(0);
    expect(exitCodeFor(record([result("a")], { cancelled: true, notRun: ["b"] }))).toBe(2);
    expect(exitCodeFor(record([], { failures: [{ id: "a", kind: "error", reason: "x" }] }))).toBe(
      2,
    );
  });
});

describe("resource residuals in the artifacts (#750 review)", () => {
  it("flags a case that left resources behind, in the HTML notes and the CSV", () => {
    const leaky = { ...result("leaky"), leaked: { geometries: 2, textures: 0 } };
    const html = reportHtml(record([leaky]), provenance);
    expect(html).toContain("resources left after disposal");
    expect(
      reportCsv(record([leaky]))
        .trim()
        .split("\n")[1]!
        .endsWith(",yes"),
    ).toBe(true);
  });
});
