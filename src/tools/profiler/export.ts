/**
 * The profiler's machine-readable export (#619; doc/game-architecture.md, "Visual performance
 * profiler", Room and export): each case's identity and configuration, the environment, the
 * method and whether GPU timing was available, raw and baseline-relative results, and the
 * registered appearances with no case.
 */
import type { CaseResult, RunOptions, RunResult } from "./runner";

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
  version: 1,
  sets: ["baseline (empty scene)", "one object", "collection on a fixed square grid"],
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
  uncovered: { family: string; missing: string[] }[];
  results: CaseResult[];
};

export function profilerExport(
  run: RunResult,
  options: RunOptions,
  environment: ProfilerEnvironmentInfo,
  uncovered: ProfilerExport["uncovered"],
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
    uncovered,
    results: run.results,
  };
}

/** The measured costs results can be sorted by: the collection's median of each. */
export const costMeasures = {
  gpu: (result: CaseResult) => result.collection.gpu?.median ?? -1,
  cpu: (result: CaseResult) => result.collection.cpu.median,
  frame: (result: CaseResult) => result.collection.frame.median,
};

/** Results by a chosen measured cost, highest first; missing GPU time sorts last, never CPU. */
export function sortedByCost(
  results: readonly CaseResult[],
  by: keyof typeof costMeasures,
): CaseResult[] {
  const cost = costMeasures[by];
  return [...results].sort((a, b) => cost(b) - cost(a));
}
