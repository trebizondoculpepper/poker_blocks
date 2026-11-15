/**
 * The profiler's machine-readable export (#619; doc/game-architecture.md, "Visual performance
 * profiler", Room and export): each case's identity and configuration, the environment, the
 * method and whether GPU timing was available, raw and baseline-relative results, and the
 * registered appearances with no case.
 */
import type { CoverageReport } from "./cases";
import type { CaseResult, RunOptions, RunResult, SampleSet } from "./runner";

export type ProfilerEnvironmentInfo = {
  userAgent: string;
  /** The WebGL renderer string, where the browser exposes it. */
  gpu: string | null;
  width: number;
  height: number;
  pixelRatio: number;
  quality: string;
};

export const profilerMethod = {
  version: 5,
  sets: [
    "baseline (empty collection, once per case in its host, through the case's own pipeline)",
    "each requested count on a fixed square grid, framed for that count (a fixed-viewport collection test)",
  ],
  warmup: "frames rendered before each set to compile shaders; creation timed separately",
  gpu: "EXT_disjoint_timer_query_webgl2, polled asynchronously; disjoint or invalid results dropped",
  relative:
    "set median minus baseline median: an estimate, not an additive per-object cost; withheld when a pass can't render an empty collection",
  pipeline:
    "each frame times the objects' updates, every declared pass and the main render, inside the CPU time and the GPU query; draw counts add up across the passes (#764)",
  hiddenTab: "a set sampled while the tab was hidden is retaken, then listed as invalidated",
  motion:
    "every case is sampled stationary; a case declaring motions is also sampled under each registered pose driver as its own row, the pose restarting with each warm-up and sample set (#973)",
  clock:
    "one presentation clock per run, a fixed step per rendered frame from zero at each case: object updates, passes and self-timed appearance parts (contained contents, flame, ice) all read it; frame time is still measured from wall time (#972)",
  prepasses:
    "a case declaring no pipeline renders through its objects' appearance prepasses as registered pipeline passes: once per frame, the empty baseline included, inside the CPU time and GPU query; a declared pipeline is complete and never adds them (#972)",
};

export type ProfilerExport = {
  exportedAt: string;
  method: typeof profilerMethod;
  environment: ProfilerEnvironmentInfo;
  options: Omit<RunOptions, "signal">;
  gpuTiming: RunResult["gpuTiming"];
  /** The run's presentation clock; null in a record from before #972, which used wall time. */
  clock: RunResult["clock"] | null;
  cancelled: boolean;
  /** Cases that failed or timed out, why the run stopped early, and what never ran (#722). */
  failures: RunResult["failures"];
  aborted: RunResult["aborted"];
  notRun: string[];
  invalidated: string[];
  /** Expected cases with no case, by catalog (kept for readers of earlier exports). */
  uncovered: { family: string; missing: string[] }[];
  /**
   * Whether the application's own rendering was paused while sampling (`paused`), or may have
   * shared the frames (`shared`): a saved benchmark keeps the difference (#735 review).
   */
  isolation: "paused" | "shared";
  /** Coverage against the composed expected catalogs (#710): providers, unsupported, totals. */
  coverage: CoverageReport;
  results: CaseResult[];
};

export function profilerExport(
  run: RunResult,
  options: RunOptions,
  environment: ProfilerEnvironmentInfo,
  coverage: CoverageReport,
  now = new Date(),
  /** Whether the application's own rendering was paused for the run (#735 review). */
  isolation: ProfilerExport["isolation"] = "shared",
): ProfilerExport {
  const { signal: _signal, ...settings } = options;
  return {
    isolation,
    exportedAt: now.toISOString(),
    method: profilerMethod,
    environment,
    options: settings,
    gpuTiming: run.gpuTiming,
    clock: run.clock,
    cancelled: run.cancelled,
    failures: run.failures,
    aborted: run.aborted,
    notRun: run.notRun,
    invalidated: run.invalidated,
    uncovered: coverage.catalogs
      .filter(({ uncovered }) => uncovered.length)
      .map(({ catalog, uncovered }) => ({ family: catalog, missing: uncovered })),
    coverage,
    results: run.results,
  };
}

/** A result's largest measured count, which rankings compare (the 50-instance collection). */
export function largestSet(result: CaseResult): SampleSet | null {
  return (
    result.counts.reduce<CaseResult["counts"][number] | null>(
      (best, entry) => (best && best.count >= entry.count ? best : entry),
      null,
    )?.set ?? null
  );
}

/** The measured costs results can be sorted by: the largest count's median of each. */
export const costMeasures = {
  gpu: (result: CaseResult) => largestSet(result)?.gpu?.median ?? -1,
  cpu: (result: CaseResult) => largestSet(result)?.cpu.median ?? -1,
  frame: (result: CaseResult) => largestSet(result)?.frame.median ?? -1,
};

/**
 * Read an exported file (#721): version 5 is today's matrix; version 4 is it from before motion
 * (#973), every row read as stationary; version 3 is also without the run clock (#972), read with
 * no clock; version 2 is the same matrix from
 * before declared pipelines (#764), every case then drawn by the main render alone, and is read as
 * that; version 1 (fixed one/collection slots) is recognised as an old result and never read as a
 * count-50 sample; anything else is refused, clearly.
 */
export function readProfilerExport(
  text: string,
): { kind: "current"; record: ProfilerExport } | { kind: "legacy"; version: 1 } {
  const parsed = JSON.parse(text) as { method?: { version?: unknown } };
  const version = parsed.method?.version;
  if (version === profilerMethod.version)
    return { kind: "current", record: parsed as ProfilerExport };
  // Before motion (#973) every row was sampled at rest: read as stationary rows.
  const atRest = (record: ProfilerExport): ProfilerExport => ({
    ...record,
    results: record.results.map((result) => ({ ...result, motion: { driver: "stationary" } })),
  });
  if (version === 4) return { kind: "current", record: atRest(parsed as ProfilerExport) };
  // Version 3 is the same record from before the run clock (#972): its updates read wall time.
  if (version === 3)
    return { kind: "current", record: atRest({ ...(parsed as ProfilerExport), clock: null }) };
  if (version === 2) {
    const record = parsed as ProfilerExport;
    const mainOnly = { passes: [], passCount: 0, setup: null };
    return {
      kind: "current",
      record: atRest({
        ...record,
        clock: null,
        results: record.results.map((result) => ({ ...result, pipeline: mainOnly })),
      }),
    };
  }
  if (version === 1) return { kind: "legacy", version: 1 };
  throw new Error(`Unsupported profiler export version: ${String(version)}`);
}

/** Results by a chosen measured cost, highest first; missing GPU time sorts last, never CPU. */
export function sortedByCost(
  results: readonly CaseResult[],
  by: keyof typeof costMeasures,
): CaseResult[] {
  const cost = costMeasures[by];
  return [...results].sort((a, b) => cost(b) - cost(a));
}
