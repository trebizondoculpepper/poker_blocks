/**
 * The one-command profiler run's artifacts (#734; doc/automatic-profiling.md, "Automatic report
 * and entry points"): a presentation CSV and a self-contained HTML summary, both built from the
 * same version-3 record and the shared report the room shows. Pure, so it is tested here.
 */
import type { ProfilerExport } from "../src/tools/profiler/export.ts";
import { profilerReport, type ProfilerReport } from "../src/tools/profiler/report.ts";

/** What a run was: the tested revision, how it was invoked, and when. */
export type RunProvenance = { revision: string; command: string; startedAt: string };

const csvCell = (value: string | number | null) => {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** One line per case, phase and count: every measured value, with its unit and host. */
export function reportCsv(record: ProfilerExport): string {
  const report = profilerReport(record);
  const header = [
    "case",
    "label",
    "phase",
    "family",
    "host",
    "pipeline",
    "unit",
    "unit_size",
    "count",
    "invalid",
    "gpu_median_ms",
    "gpu_p95_ms",
    "cpu_median_ms",
    "draw_calls",
    "triangles",
    "leaked",
  ];
  const lines = report.rows.flatMap((row) =>
    row.counts.map((count, index) =>
      [
        row.id,
        row.label,
        row.phase ?? "",
        row.family,
        row.host,
        row.pipeline,
        row.unit.kind,
        row.unit.size,
        count,
        row.invalid[index] ? "yes" : "",
        row.gpu[index] ?? null,
        row.gpuP95[index] ?? null,
        row.cpu[index] ?? null,
        row.calls[index] ?? null,
        row.triangles[index] ?? null,
        row.leaked ? "yes" : "",
      ]
        .map(csvCell)
        .join(","),
    ),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}

const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** A self-contained page: banner, provenance, rankings, growth and the full per-count table. */
export function reportHtml(record: ProfilerExport, provenance: RunProvenance): string {
  const report: ProfilerReport = profilerReport(record);
  const ms = (n: number | null | undefined) =>
    n === null || n === undefined ? "n/a" : n.toFixed(3);
  const rankings = report.rankings
    .map(
      ({ title, count, entries }) =>
        `<h2>${escape(title)}${count ? `, ${count} instances` : ""}</h2><ol>${entries
          .map(({ text }) => `<li>${escape(text)}</li>`)
          .join("")}</ol>`,
    )
    .join("");
  const rows = report.rows
    .map(
      (row) =>
        `<tr><td>${escape(row.phase ? `${row.label} (${row.phase})` : row.label)}</td><td>${escape(row.family)}</td><td>${escape(row.host)}</td><td>${escape(row.pipeline)}</td><td>${escape(`${row.unit.kind} ×${row.unit.size}`)}</td><td>${row.counts.join(" / ")}</td><td>${row.gpu.map(ms).join(" / ")}</td><td>${row.cpu.map(ms).join(" / ")}</td><td>${row.calls.join(" / ")}</td><td>${row.triangles.join(" / ")}</td><td>${escape(caseNotes(row))}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Profiler report</title>
<style>
body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#1b1f24;background:#fff}
h1{font-size:20px}h2{font-size:16px;margin-top:24px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left}
.banner{padding:10px 12px;background:#f3f5f8;border-radius:6px}.notes li{color:#7a3b00}
@media (prefers-color-scheme: dark){body{background:#14171c;color:#e6e8eb}.banner{background:#1f242c}th,td{border-color:#333}}
</style></head><body>
<h1>Profiler report</h1>
<p class="banner">${escape(report.banner.summary)} · ${escape(report.banner.coverage)}</p>
<ul class="notes">${report.banner.notes.map((note) => `<li>${escape(note)}</li>`).join("")}</ul>
<p>Revision ${escape(provenance.revision)} · ${escape(provenance.command)} · started ${escape(provenance.startedAt)} · renderer string: ${escape(record.environment.gpu ?? "unavailable")}</p>
${rankings}
<h2>Growth by case</h2><ul>${report.rows.map(({ growthText }) => `<li>${escape(growthText)}</li>`).join("")}</ul>
<h2>Every case</h2>
<table><thead><tr><th>Case</th><th>Family</th><th>Host</th><th>Pipeline</th><th>Unit</th><th>Counts</th><th>GPU ms</th><th>CPU ms</th><th>Calls</th><th>Triangles</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>
`;
}

/** A case's flags for a person: invalid sets, and resources left after disposal (#750 review). */
function caseNotes(row: ProfilerReport["rows"][number]): string {
  return [
    ...(row.invalid.some(Boolean) ? ["invalid set"] : []),
    ...(row.leaked ? ["resources left after disposal"] : []),
    ...(row.baselineUnavailable ? [`no matched baseline: ${row.baselineUnavailable}`] : []),
  ].join("; ");
}

/** The run's exit status: success only for complete supported coverage without errors. */
export function exitCodeFor(record: ProfilerExport): number {
  return profilerReport(record).banner.status === "complete" ? 0 : 2;
}
