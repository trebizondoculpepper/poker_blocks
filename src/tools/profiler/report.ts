/**
 * The profiler's end-of-run report (#733; doc/automatic-profiling.md, "Automatic report and
 * entry points"), built from a version-3 record. Pure: the room renders it, and the one-command
 * run (#734) formats the same report as files.
 *
 * - The banner states the renderer (hardware, software or unknown), whether GPU timing was valid,
 *   whether the run was isolated, its status (complete, partial or with errors) and coverage.
 * - One row per case and phase, with its value at each count.
 * - Rankings compare the largest count: the most expensive collections by valid GPU median, then
 *   CPU update and submission, then draw calls. With no valid GPU timing, the CPU ranking leads,
 *   labelled as CPU; it is never presented as GPU cost. Missing GPU values are left out of the GPU
 *   ranking, never counted as zero. Ties keep catalog order.
 * - Rows are also summarised by unit kind (blocks apart from groups and emitters), without the
 *   report asking what any kind is.
 */
import type { ProfilerExport } from "./export";
import { describePipeline } from "./pipelines";
import type { CaseResult, CountResult } from "./runner";

export type RendererKind = "hardware" | "software" | "unknown";

/** A software rasteriser names itself in the WebGL renderer string; no string, no claim. */
export function rendererKind(gpu: string | null): RendererKind {
  if (!gpu) return "unknown";
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu) ? "software" : "hardware";
}

export type ReportRow = {
  id: string;
  label: string;
  family: string;
  phase?: string;
  host: string;
  /** Its render pipeline as a person reads it (#764): declared passes, then the main render. */
  pipeline: string;
  /** Why baseline-relative values are withheld for its pipeline, if they are. */
  baselineUnavailable?: string;
  unit: CaseResult["unit"];
  /** One entry per measured count, in order. */
  counts: number[];
  gpu: (number | null)[];
  gpuP95: (number | null)[];
  cpu: number[];
  calls: number[];
  triangles: number[];
  /** Largest count's median over the smallest count's: how the cost grew (null when unknown). */
  growth: { gpu: number | null; cpu: number | null };
  /** Growth from the smallest count to the largest, as a person reads it. */
  growthText: string;
  /** Per count: whether its set was invalidated (the tab stayed hidden through every retry). */
  invalid: boolean[];
  /** The empty baseline was invalidated, so baseline-relative estimates are withheld. */
  baselineInvalid: boolean;
  leaked: boolean;
};

export type RankedEntry = {
  row: ReportRow;
  /** The entry as a person reads it, formatted for its measure. */
  text: string;
  /** The ranked value at the largest count. */
  value: number;
  p95: number | null;
  /** Baseline-relative estimate at the largest count, where known. */
  relative: number | null;
};

export type Ranking = {
  /** What is ranked, said plainly: GPU, CPU update and submission, or draw calls. */
  title: string;
  measure: "gpu" | "cpu" | "calls";
  count: number | null;
  entries: RankedEntry[];
};

export type ProfilerReport = {
  banner: {
    renderer: RendererKind;
    gpuTiming: "valid" | "unavailable";
    isolation: ProfilerExport["isolation"];
    status: "complete" | "partial" | "errors";
    /** The banner as one line for a person. */
    summary: string;
    coverage: string;
    notes: string[];
  };
  rows: ReportRow[];
  rankings: Ranking[];
  /** Rows grouped by unit kind, in catalog order within each. */
  byUnit: { kind: string; rows: ReportRow[] }[];
};

const largest = (counts: readonly CountResult[]): CountResult | null =>
  counts.reduce<CountResult | null>(
    (best, entry) => (best && best.count >= entry.count ? best : entry),
    null,
  );
const smallest = (counts: readonly CountResult[]): CountResult | null =>
  counts.reduce<CountResult | null>(
    (best, entry) => (best && best.count <= entry.count ? best : entry),
    null,
  );
const ratio = (top: number | null | undefined, bottom: number | null | undefined) =>
  top === null || top === undefined || !bottom ? null : top / bottom;

/** The name the runner gives a case's set when it invalidates it: `<case>[:<phase>]/<set>`. */
const setName = (result: CaseResult, set: string | number) =>
  `${result.phase ? `${result.id}:${result.phase}` : result.id}/${set}`;

function rowOf(result: CaseResult, invalidated: ReadonlySet<string>): ReportRow {
  const top = largest(result.counts);
  const bottom = smallest(result.counts);
  const invalid = result.counts.map(({ count }) => invalidated.has(setName(result, count)));
  // Growth only between two trustworthy sets.
  const trusted = (entry: CountResult | null) =>
    entry !== null && !invalidated.has(setName(result, entry.count));
  const growth =
    trusted(top) && trusted(bottom)
      ? {
          gpu: ratio(top?.set.gpu?.median, bottom?.set.gpu?.median),
          cpu: ratio(top?.set.cpu.median, bottom?.set.cpu.median),
        }
      : { gpu: null, cpu: null };
  const times = (value: number | null) => (value === null ? "n/a" : `×${value.toFixed(1)}`);
  const name = result.phase ? `${result.label} (${result.phase})` : result.label;
  return {
    invalid,
    baselineInvalid: invalidated.has(setName(result, "baseline")),
    growthText: `${name}: GPU ${times(growth.gpu)}, CPU ${times(growth.cpu)} (${bottom?.count ?? "?"} → ${top?.count ?? "?"})`,
    id: result.id,
    label: result.label,
    family: result.family,
    ...(result.phase ? { phase: result.phase } : {}),
    host: result.host,
    pipeline: describePipeline(result.pipeline.passes),
    ...(result.baselineUnavailable ? { baselineUnavailable: result.baselineUnavailable } : {}),
    unit: result.unit,
    counts: result.counts.map(({ count }) => count),
    gpu: result.counts.map(({ set }) => set.gpu?.median ?? null),
    gpuP95: result.counts.map(({ set }) => set.gpu?.p95 ?? null),
    cpu: result.counts.map(({ set }) => set.cpu.median),
    calls: result.counts.map(({ set }) => set.counts.calls),
    triangles: result.counts.map(({ set }) => set.counts.triangles),
    growth,
    leaked: result.leaked.geometries > 0 || result.leaked.textures > 0,
  };
}

/** Highest first; a stable sort, so ties keep catalog order. */
const ms = (n: number | null) => (n === null ? "n/a" : n.toFixed(3));
const nameOf = (row: ReportRow) => (row.phase ? `${row.label} (${row.phase})` : row.label);
/** A timing entry: its median, p95 and baseline-relative estimate, in milliseconds. */
const timing = (row: ReportRow, value: number, p95: number | null, relative: number | null) =>
  `${nameOf(row)}: ${ms(value)} ms (p95 ${ms(p95)}; vs baseline ${ms(relative)})`;

function ranked(
  pairs: readonly { row: ReportRow; result: CaseResult }[],
  pick: (top: CountResult) => { value: number | null; p95: number | null; relative: number | null },
  topN: number,
  describe: (
    row: ReportRow,
    value: number,
    p95: number | null,
    relative: number | null,
  ) => string = timing,
): RankedEntry[] {
  return pairs
    .flatMap(({ row, result }) => {
      const top = largest(result.counts);
      // An invalidated set is not a valid measurement: it is never ranked.
      if (!top || row.invalid[result.counts.indexOf(top)]) return [];
      const picked = pick(top);
      const { value, p95 } = picked;
      const relative = row.baselineInvalid ? null : picked.relative;
      return value === null
        ? []
        : [{ row, text: describe(row, value, p95, relative), value, p95, relative }];
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);
}

export function profilerReport(record: ProfilerExport, topN = 10): ProfilerReport {
  const invalidated = new Set(record.invalidated);
  const hosts = [...new Set(record.results.map(({ host }) => host))];
  const mixedHosts = hosts.length > 1;
  // Cases rendered through different pipelines are compared only with their passes named (#764).
  const pipelines = [
    ...new Set(record.results.map(({ pipeline }) => describePipeline(pipeline.passes))),
  ];
  const mixedPipelines = pipelines.length > 1;
  const pairs = record.results.map((result) => ({ result, row: rowOf(result, invalidated) }));
  const rows = pairs.map(({ row }) => row);
  const top = Math.max(
    0,
    ...record.results.flatMap(({ counts }) => counts.map(({ count }) => count)),
  );
  const gpuValid =
    record.gpuTiming === "available" && pairs.some(({ result }) => largest(result.counts)?.set.gpu);
  const gpu: Ranking = {
    title: "Most expensive collections by GPU time (median)",
    measure: "gpu",
    count: top || null,
    entries: ranked(
      pairs,
      ({ set, relative }) => ({
        value: set.gpu?.median ?? null,
        p95: set.gpu?.p95 ?? null,
        relative: relative.gpu,
      }),
      topN,
    ),
  };
  const cpu: Ranking = {
    title: gpuValid
      ? "Most expensive collections by CPU update and submission (median)"
      : "CPU update and submission (median): GPU timing unavailable, so this is not GPU cost",
    measure: "cpu",
    count: top || null,
    entries: ranked(
      pairs,
      ({ set, relative }) => ({ value: set.cpu.median, p95: set.cpu.p95, relative: relative.cpu }),
      topN,
    ),
  };
  const calls: Ranking = {
    title: "Most draw calls",
    measure: "calls",
    count: top || null,
    entries: ranked(
      pairs,
      ({ set }) => ({ value: set.counts.calls, p95: null, relative: null }),
      topN,
      (row, value) => `${nameOf(row)}: ${value} calls`,
    ),
  };
  const stopped = record.cancelled || record.aborted !== null || record.notRun.length > 0;
  // A run that measured fewer cases than the catalogs make available (a selected run) never
  // claims full coverage, however complete the catalogs are.
  const measured = new Set([...record.results, ...record.failures].map(({ id }) => id)).size;
  const selected = measured < record.coverage.totals.available;
  const [status, statusText] = record.failures.length
    ? (["errors", "With errors"] as const)
    : stopped || selected || record.invalidated.length > 0 || !record.coverage.complete
      ? (["partial", "Partial"] as const)
      : (["complete", "Complete"] as const);
  const renderer = rendererKind(record.environment.gpu);
  const gpuTiming = gpuValid ? "valid" : "unavailable";
  const isolated = record.isolation === "paused";
  const { expected, available, unsupported, uncovered } = record.coverage.totals;
  const kinds = [...new Set(rows.map(({ unit }) => unit.kind))];
  return {
    banner: {
      renderer,
      gpuTiming,
      isolation: record.isolation,
      status,
      summary: `${statusText} · renderer ${renderer} · GPU timing ${gpuTiming} · ${isolated ? "isolated" : "not isolated"}`,
      coverage: `${available} of ${expected} expected cases available, ${unsupported} unsupported, ${uncovered} uncovered`,
      notes: [
        ...(record.aborted ? [`Stopped: ${record.aborted}`] : []),
        ...(record.cancelled ? ["Cancelled before every case ran"] : []),
        ...(record.notRun.length ? [`${record.notRun.length} case(s) not run`] : []),
        ...(selected
          ? [
              `Selected run: ${measured} of ${record.coverage.totals.available} available cases measured`,
            ]
          : []),
        ...record.failures.map(
          ({ id, phase, kind, reason }) =>
            `${phase ? `${id}:${phase}` : id} failed (${kind}): ${reason}`,
        ),
        ...(isolated ? [] : ["Not isolated: other rendering may have shared the frames"]),
        ...(mixedHosts
          ? [
              `Cases were drawn in ${hosts.length} different hosts (${hosts.join(", ")}): rankings name each entry's host`,
            ]
          : []),
        ...(mixedPipelines
          ? [
              `Cases were rendered through ${pipelines.length} different pipelines: rankings name each entry's passes`,
            ]
          : []),
        ...rows.flatMap(({ id, baselineUnavailable }) =>
          baselineUnavailable ? [`${id}: no matched baseline (${baselineUnavailable})`] : [],
        ),
        ...(record.invalidated.length
          ? [
              `${record.invalidated.length} set(s) invalidated (tab hidden through every retry), left out of the rankings: ${record.invalidated.join(", ")}`,
            ]
          : []),
      ],
    },
    rows,
    // With no valid GPU timing, the labelled CPU ranking comes first. When the cases were drawn
    // in different hosts, every entry names its host, so a lighting difference never passes as
    // a difference in object cost (#741 review).
    rankings: (gpuValid ? [gpu, cpu, calls] : [cpu, calls]).map((ranking) => ({
      ...ranking,
      entries: ranking.entries.map((entry) => ({
        ...entry,
        text: [
          entry.text,
          ...(mixedHosts ? [`[host: ${entry.row.host}]`] : []),
          ...(mixedPipelines ? [`[pipeline: ${entry.row.pipeline}]`] : []),
        ].join(" "),
      })),
    })),
    byUnit: kinds.map((kind) => ({ kind, rows: rows.filter((row) => row.unit.kind === kind) })),
  };
}
