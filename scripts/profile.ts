// The one-command profiler run (#734; doc/automatic-profiling.md, "Automatic report and entry
// points"):
//   npm run profile [-- --out DIR] [--port N] [--url URL] [--timeout-minutes N]
// (--port picks the dev server's port; a free one by default.)
//
// It starts its own dev server (or uses --url), opens an isolated headless Chrome on the dev18
// mode, which composes the same devProfiler trait as dev16 plus the command sink, waits for the
// automatic sweep's record, and writes report.json (the version-2 record), report.csv and
// report.html, with the tested revision and command recorded. Exit 0 only for a complete run
// (every supported case measured, nothing failed or invalid); 2 for a partial one, whose report
// is still saved; 1 when it could not run. It cleans up only the server and browser it started.
// Chrome is found at its usual macOS path, or set CHROME to its executable.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProfilerExport } from "../src/tools/profiler/export.ts";
import { exitCodeFor, reportCsv, reportHtml } from "./profile-artifacts.ts";

const argument = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const root = join(import.meta.dirname, "..");
const startedAt = new Date().toISOString();
/** A port nobody is listening on now, so this run never talks to another run's server or browser. */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
const timeoutMs = Number(argument("timeout-minutes") ?? 240) * 60_000;
const out = argument("out") ?? join(root, "profiles", startedAt.replaceAll(":", "-"));
const chromePath =
  process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const revision = `${git("rev-parse", "--short", "HEAD")}${git("status", "--porcelain") ? " (with local changes)" : ""}`;

const started: ChildProcess[] = [];
const profileDir = mkdtempSync(join(tmpdir(), "poker-blocks-profile-"));
/** A launch failure (no Chrome at that path, say), surfaced to the waits below (#750 review). */
let launchError: Error | null = null;

/** Start a process this run owns, in its own process group, and watch for a failed launch. */
function own(command: string, args: readonly string[]): ChildProcess {
  const child = spawn(command, args, { cwd: root, stdio: "ignore", detached: true });
  child.once("error", (error) => {
    launchError ??= new Error(`Could not start ${command}: ${error.message}`);
  });
  started.push(child);
  return child;
}

/** Signal a process's whole group, ignoring one that has already gone. */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Already exited.
  }
}

/**
 * Stop only what this run started (each whole process group), wait for each to exit, then remove
 * the browser's temporary profile. A cleanup problem is reported but never changes the run's
 * exit status.
 */
async function cleanUp(): Promise<void> {
  await Promise.all(
    started.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null)
            return resolve();
          child.once("exit", () => resolve());
          signalGroup(child, "SIGTERM");
          setTimeout(() => {
            signalGroup(child, "SIGKILL");
            resolve();
          }, 5000);
        }),
    ),
  );
  try {
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    console.warn(
      `Could not remove ${profileDir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
process.on("SIGINT", () => {
  void cleanUp().then(() => process.exit(1));
});

async function waitFor<T>(
  what: string,
  probe: () => Promise<T | undefined>,
  ms: number,
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    if (launchError) throw launchError;
    const value = await probe().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await sleep(500);
  }
}

async function main(): Promise<number> {
  // The page: the given URL, or a dev server of our own.
  let base = argument("url");
  if (!base) {
    const port = Number(argument("port") ?? (await freePort()));
    // The project's own dev server, launched directly (no npx wrapper, nothing fetched), in a
    // process group of its own so stopping it stops everything it started (#750 review).
    own(process.execPath, [
      join(root, "node_modules", "vite-plus", "bin", "vp"),
      "dev",
      "--port",
      String(port),
      "--strictPort",
    ]);
    base = `http://localhost:${port}/`;
    await waitFor(
      "the dev server",
      async () => ((await fetch(base!)).ok ? true : undefined),
      60_000,
    );
  }
  // Chrome's debugging endpoint on a port of its own: never another run's browser (#750 review).
  const debugPort = await freePort();
  own(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    "--window-size=1600,1000",
    "about:blank",
  ]);
  const target = await waitFor(
    "Chrome",
    async () =>
      (
        (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()) as {
          type: string;
          webSocketDebuggerUrl: string;
        }[]
      ).find(({ type }) => type === "page"),
    30_000,
  );
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  // Every request settles: answered, timed out, or rejected when the connection is lost, so a
  // crashed browser reaches the error and cleanup path instead of hanging (#750 review).
  let id = 0;
  let lost: Error | null = null;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const loseAll = (error: Error) => {
    lost ??= error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  socket.addEventListener("message", (message) => {
    const data = JSON.parse(String(message.data)) as { id?: number; result?: unknown };
    if (data.id === undefined) return;
    pending.get(data.id)?.resolve(data.result);
    pending.delete(data.id);
  });
  socket.addEventListener("close", () =>
    loseAll(new Error("The browser's debugging connection closed")),
  );
  socket.addEventListener("error", () =>
    loseAll(new Error("The browser's debugging connection failed")),
  );
  const send = (method: string, params: object = {}) =>
    new Promise<unknown>((resolve, reject) => {
      if (lost) return reject(lost);
      const call = ++id;
      const timer = setTimeout(() => {
        pending.delete(call);
        reject(new Error(`The browser did not answer ${method} within 30 s`));
      }, 30_000);
      pending.set(call, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.send(JSON.stringify({ id: call, method, params }));
    });
  const evaluate = async <T>(expression: string) =>
    (
      (await send("Runtime.evaluate", { expression, returnByValue: true })) as {
        result?: { value?: T };
      }
    ).result?.value;

  await send("Page.navigate", { url: new URL("?mode=dev18", base).href });
  console.log(`Profiling ${revision} at ${base} (dev18); writing to ${out}`);
  const deadline = Date.now() + timeoutMs;
  let last = "";
  let delivery: { record: ProfilerExport; partial: boolean } | undefined;
  while (!delivery) {
    await sleep(5000);
    delivery = await evaluate<{ record: ProfilerExport; partial: boolean }>(
      "globalThis.profilerDeliveries?.at(-1)",
    );
    const status = await evaluate<string>(
      "document.querySelector('.profiler-room [data-part=\"status\"]')?.textContent",
    );
    if (status && status !== last) console.log(status);
    last = status ?? last;
    // Out of time: cancel, and keep the partial record the trait then delivers.
    if (!delivery && Date.now() > deadline) {
      console.log("Time limit reached: cancelling and saving the partial report.");
      await evaluate("document.querySelector('.profiler-room [data-part=\"cancel\"]')?.click()");
      delivery = await waitFor(
        "the partial record",
        () =>
          evaluate<{ record: ProfilerExport; partial: boolean }>(
            "globalThis.profilerDeliveries?.at(-1)",
          ),
        120_000,
      );
    }
  }
  socket.close();
  const provenance = { revision, command: process.argv.slice(1).join(" "), startedAt };
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, "report.json"),
    JSON.stringify({ provenance, ...delivery.record }, null, 2),
  );
  writeFileSync(join(out, "report.csv"), reportCsv(delivery.record));
  writeFileSync(join(out, "report.html"), reportHtml(delivery.record, provenance));
  const code = delivery.partial ? 2 : exitCodeFor(delivery.record);
  console.log(`${code === 0 ? "Complete" : "Partial"}: report written to ${out}`);
  return code;
}

void main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  })
  .then(async (code) => {
    await cleanUp();
    process.exit(code);
  });
