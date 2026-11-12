#!/usr/bin/env node
/** One read-only intake command. Contract: doc/github-triage-cli.md. */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { collect, currentRepository } from "./github.ts";
import { briefing, textReport } from "./briefing.ts";
import type { Snapshot } from "./types.ts";

export const help = `Usage: npm run triage -- [options]
Read-only LLM action briefing. Requires authenticated gh and Node 22.18+.
  --repo owner/name     Repository (default: current gh checkout)
  --json                Versioned structured output (use npm run --silent triage)
  --issue N             Include full issue body/history, even if closed
  --since ISO           Include changed issues/PRs in all states since timestamp
  --checkpoint PATH     Read last successful window; advance only after complete live output
  --cache PATH          Save full successful snapshot atomically
  --offline             Read explicit cache; no GitHub queries/checkpoint advancement
  --limit N             Items per bounded section (default 10)
  --help                Show usage
Exit: 0 complete; 2 incomplete evidence; 1 invalid arguments/API/cache failure.
No GitHub mutations. Question/dependency hints require inspection, not blind action.
`;
export function argumentsFor(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      repo: { type: "string" },
      json: { type: "boolean" },
      issue: { type: "string" },
      since: { type: "string" },
      checkpoint: { type: "string" },
      cache: { type: "string" },
      offline: { type: "boolean" },
      limit: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.repo && !/^[\w.-]+\/[\w.-]+$/.test(values.repo))
    throw new Error("--repo must be owner/name.");
  const positive = (text: string, option: string) => {
    if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text)))
      throw new Error(`${option} must be a positive integer.`);
    return Number(text);
  };
  if (
    values.since &&
    (!/^\d{4}-\d\d-\d\dT/.test(values.since) ||
      !/(?:Z|[+-]\d{2}:\d{2})$/.test(values.since) ||
      !Number.isFinite(Date.parse(values.since)))
  )
    throw new Error("--since must be an ISO timestamp with a time.");
  if (values.offline && values.since)
    throw new Error("--since requires a live fetch; offline data cannot verify changes.");
  if (values.offline && !values.cache) throw new Error("--offline requires --cache PATH.");
  return {
    ...values,
    issue: values.issue ? positive(values.issue, "--issue") : undefined,
    limit: positive(values.limit ?? "10", "--limit"),
    since: values.since ? new Date(values.since).toISOString() : undefined,
  };
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, path);
}
export async function cachedSnapshot(path: string, repository?: string): Promise<Snapshot> {
  const data = JSON.parse(await readFile(path, "utf8")) as Snapshot;
  if (
    data.schemaVersion !== 1 ||
    typeof data.repository !== "string" ||
    (repository && data.repository !== repository) ||
    !Number.isFinite(Date.parse(data.fetchedAt)) ||
    !Number.isFinite(Date.parse(data.startedAt)) ||
    ![data.issues, data.pullRequests, data.dependencies, data.changed, data.warnings].every(
      Array.isArray,
    )
  )
    throw new Error("Cache schema/repository is invalid or unsupported.");
  return data;
}
export async function checkpointSince(
  path: string,
  repository: string,
): Promise<string | undefined> {
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    if (
      data.schemaVersion !== 1 ||
      data.repository !== repository ||
      !Number.isFinite(Date.parse(data.through))
    )
      throw new Error("Checkpoint schema/repository is invalid.");
    return data.through;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export async function main(
  args: string[],
  output: (text: string) => Promise<void> = (text) =>
    new Promise((resolve, reject) =>
      process.stdout.write(text, (error) => (error ? reject(error) : resolve())),
    ),
  runtime = { collect, currentRepository },
): Promise<number> {
  const options = argumentsFor(args);
  if (options.help) {
    await output(help);
    return 0;
  }
  let snapshot: Snapshot;
  if (options.offline) snapshot = await cachedSnapshot(options.cache!, options.repo);
  else {
    const repository = options.repo ?? (await runtime.currentRepository());
    const previous = options.checkpoint
      ? await checkpointSince(options.checkpoint, repository)
      : undefined;
    snapshot = await runtime.collect(repository, {
      issue: options.issue,
      since: options.since ?? previous,
    });
    if (options.cache) await atomicJson(options.cache, snapshot);
  }
  if (options.issue && !snapshot.issues.some((issue) => issue.number === options.issue))
    throw new Error(`Issue #${options.issue} not in this cache. Refresh live with --issue.`);
  const report = briefing(snapshot, options);
  const checkpoint = options.checkpoint
    ? {
        previousWindow: snapshot.since,
        establishesBaseline: !snapshot.since,
        nextThroughCandidate:
          !options.offline && report.completeness.complete ? snapshot.startedAt : null,
        policy:
          "Advance only after complete successful live output; offline/incomplete results never advance.",
      }
    : null;
  const checkpointText = checkpoint
    ? `Checkpoint: ${checkpoint.establishesBaseline ? "establishing current baseline" : `previous window ${checkpoint.previousWindow}`}; ${checkpoint.policy}\n`
    : "";
  await output(
    options.json
      ? JSON.stringify({ ...report, checkpoint }, null, 2) + "\n"
      : textReport(report) + checkpointText,
  );
  if (!options.offline && options.checkpoint && report.completeness.complete)
    // Start time deliberately overlaps windows: updates arriving during collection are not lost.
    await atomicJson(options.checkpoint, {
      schemaVersion: 1,
      repository: snapshot.repository,
      through: snapshot.startedAt,
    });
  return report.completeness.complete ? 0 : 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`triage: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
