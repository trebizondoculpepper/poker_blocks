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
  version: 2,
  sets: [
    "baseline (empty scene, once per case in its host)",
    "each requested count on a fixed square grid, framed for that count (a fixed-viewport collection test)",
  ],
  warmup: "frames rendered before each set to compile shaders; creation timed separately",
  gpu: "EXT_disjoint_timer_query_webgl2, polled asynchronously; disjoint or invalid results dropped",
  relative: "set median minus baseline median: an estimate, not an additive per-object cost",
  hiddenTab: "a set sampled while the tab was hidden is retaken, then listed as invalidated",
};

export type ProfilerExport = {
  exportedAt: string;
  method: typeof profilerMethod;
  environment: ProfilerEnvironmentInfo;
  options: Omit<RunOptions, "signal">;
  gpuTiming: RunResult["gpuTiming"];
  cancelled: boolean;
  invalidated: string[];
  /** Expected cases with no case, by catalog (kept for readers of earlier exports). */
  uncovered: { family: string; missing: string[] }[];
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
): ProfilerExport {
  const { signal: _signal, ...settings } = options;
  return {
    exportedAt: now.toISOString(),
    method: profilerMethod,
    environment,
    options: settings,
    gpuTiming: run.gpuTiming,
    cancelled: run.cancelled,
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
 * Read an exported file (#721): version 2 is today's matrix; version 1 (fixed one/collection
 * slots) is recognised as an old result and never read as a count-50 sample; anything else is
 * refused, clearly.
 */
export function readProfilerExport(
  text: string,
): { kind: "current"; record: ProfilerExport } | { kind: "legacy"; version: 1 } {
  const parsed = JSON.parse(text) as { method?: { version?: unknown } };
  const version = parsed.method?.version;
  if (version === profilerMethod.version)
    return { kind: "current", record: parsed as ProfilerExport };
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
