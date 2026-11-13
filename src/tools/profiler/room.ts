/**
 * The visual performance profiler room (dev16, #619; doc/game-architecture.md, "Visual
 * performance profiler"). Runs all or selected registered profiling cases through the runner
 * (#618), with a chosen collection size, resolution and quality; a run can be cancelled. Results
 * sort by a measured cost so outliers show (no fixed "expensive" threshold), selecting a row
 * previews that object's real visual, and Export saves the full JSON. The coverage list names
 * registered appearances with no case.
 *
 * The room's own UI is not redrawn while a run samples: the results table is filled when it ends.
 * Developer-only: production never imports it (src/main.ts).
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { playSfx } from "../../audio/sfx";
import { gameModeFor, modeLink } from "../../game-modes";
import "./all-cases";
import {
  catalogCoverage,
  defaultProfilingHost,
  describeCoverage,
  profilingCases,
  profilingCoverage,
  type ProfiledObject,
  type ProfilingCase,
} from "./cases";
import {
  costMeasures,
  largestSet,
  profilerExport,
  sortedByCost,
  type ProfilerEnvironmentInfo,
  type ProfilerExport,
} from "./export";
import {
  createDevProfilerScope,
  profilerResultSinks,
  type DevProfilerScope,
  type SweepDelivery,
} from "./autorun";
import { createGpuTimer } from "./gpu-timer";
import { createHostTracker } from "./host-tracker";
import { describePipeline, type ProfilingPipeline } from "./pipelines";
import { profilerReport, type ProfilerReport } from "./report";
import {
  createProfilerRunner,
  standardCounts,
  type CaseResult,
  type RunOptions,
  type RunResult,
} from "./runner";
import "./room.css";

/**
 * The counts and frames inputs as run settings (#721): counts are a list of positive whole numbers
 * (at most 200 each), deduplicated and ascending, the standard [1, 10, 50] when none are readable;
 * frames are bounded too.
 */
export function runSettings(countsText: string, framesText: string) {
  const whole = (text: string, fallback: number, min: number, max: number) => {
    const number = Math.round(Number(text));
    return Number.isFinite(number) && number >= min ? Math.min(max, number) : fallback;
  };
  const counts = [
    ...new Set(
      countsText
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((text) => whole(text, 0, 1, 200))
        .filter((count) => count > 0),
    ),
  ].sort((a, b) => a - b);
  return {
    counts: counts.length ? counts : [...standardCounts],
    frames: whole(framesText, 120, 10, 2000),
  };
}

/** The room's composed configuration: where Back goes, and the catalogs it must cover (#710). */
export type ProfilerRoomConfig = { backTo: string; catalogs: readonly string[] };
export type ProfilerRoom = {
  show(config: ProfilerRoomConfig): void;
  hide(): void;
  dispose(): void;
  /** A run scope for the composing `devProfiler` trait, over this room's capabilities (#732). */
  orchestration(): DevProfilerScope<ProfilerExport>;
  /** Hear the Run all button; returns how to stop listening. */
  onRunAll(listener: () => void): () => void;
  /** The on-screen result sink. */
  showReport(delivery: SweepDelivery<ProfilerExport>): void;
};

/**
 * The command sink (#734): it publishes each delivery on the page, where the one-command run
 * (\`npm run profile\`) collects it over the browser's debugging protocol and writes the files.
 * It holds the record only; it never writes, downloads or decides anything itself.
 */
if (!profilerResultSinks.has("command"))
  profilerResultSinks.register("command", () => (delivery) => {
    const page = globalThis as unknown as { profilerDeliveries?: unknown[] };
    (page.profilerDeliveries ??= []).push(delivery);
  });

// The room's on-screen sink, by name, for a trait's configuration to list.
if (!profilerResultSinks.has("screen"))
  profilerResultSinks.register(
    "screen",
    (host) => (delivery) =>
      (host as ProfilerRoom).showReport(delivery as SweepDelivery<ProfilerExport>),
  );

/** Frames a preview advances before it is shown. */
const previewFrames = 30;

/** Render qualities offered: the pixel ratio each one uses. */
const qualities = { low: 1, standard: 1.5, high: 2 };

/** What the application lends the room: pausing its own frame loop during a sweep (#735 review). */
export type ProfilerRoomCapabilities = { pauseRendering?: () => () => void };

export function createProfilerRoom(
  host: HTMLElement,
  capabilities: ProfilerRoomCapabilities = {},
): ProfilerRoom {
  // The catalogs the composing trait expects, captured on entry; none until then.
  let expectedCatalogs: string[] = [];
  const root = document.createElement("section");
  root.className = "profiler-room";
  root.hidden = true;
  root.innerHTML = `
    <header class="profiler-room-header">
      <h1>Visual profiler</h1>
      <a data-part="back" href="#">Back to the game</a>
    </header>
    <aside class="profiler-room-controls">
      <fieldset data-part="cases"><legend>Cases</legend></fieldset>
      <label>Counts <input data-part="counts" type="text" value="1, 10, 50" /></label>
      <label>Frames per set <input data-part="frames" type="number" min="10" max="2000" value="120" /></label>
      <label>Resolution <select data-part="resolution">
        <option value="640x360">640 × 360</option>
        <option value="1280x720" selected>1280 × 720</option>
        <option value="1920x1080">1920 × 1080</option>
      </select></label>
      <label>Quality <select data-part="quality">
        ${Object.keys(qualities)
          .map((name) => `<option>${name}</option>`)
          .join("")}
      </select></label>
      <label>Sort by <select data-part="sort">
        ${Object.keys(costMeasures)
          .map((name) => `<option>${name}</option>`)
          .join("")}
      </select></label>
      <div class="profiler-room-buttons">
        <button type="button" data-part="run-all">Run all (1 / 10 / 50)</button>
        <button type="button" data-part="run">Run selected</button>
        <button type="button" data-part="cancel" disabled>Cancel</button>
        <button type="button" data-part="export" disabled>Export JSON</button>
      </div>
      <p data-part="status" role="status"></p>
      <div data-part="coverage" class="profiler-room-coverage"></div>
    </aside>
    <div class="profiler-room-main">
      <div class="profiler-room-stage" data-part="stage"></div>
      <section class="profiler-room-report" data-part="report" aria-live="polite"></section>
      <table class="profiler-room-results">
        <thead><tr><th>Case</th><th>Family</th><th>Counts</th><th>GPU ms</th><th>CPU ms</th><th>Frame ms (p95), largest</th><th>Calls</th><th>Triangles</th><th>Create ms</th><th>Passes</th><th>Leak</th></tr></thead>
        <tbody data-part="results"></tbody>
      </table>
    </div>`;
  host.append(root);
  const part = <T extends HTMLElement>(name: string) =>
    root.querySelector<T>(`[data-part="${name}"]`)!;
  const value = (name: string) => part<HTMLInputElement>(name).value;
  // The middle quality is where a run starts.
  part<HTMLSelectElement>("quality").selectedIndex = 1;

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
  part("stage").append(renderer.domElement);
  // Its own reflections: the game's environment belongs to another WebGL context, so metals and
  // crystal would otherwise be measured reflecting nothing (#653 review).
  const reflections = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04);
  const timer = createGpuTimer(renderer.getContext() as WebGL2RenderingContext);
  const runner = createProfilerRunner({
    renderer,
    timer,
    now: () => performance.now(),
    nextFrame: () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
    // Its own reflections: the game's environment belongs to another WebGL context, so metals and
    // crystal would otherwise be measured reflecting nothing (#653 review). Hosts apply it (#712).
    reflections: () => reflections.texture,
    hidden: () => document.hidden,
    visibilityChanges: () => visibilityChanges,
    // A lost context stops the run with the reason recorded (#722).
    contextLost: () => contextLost,
    onContextLost: (listener) => {
      renderer.domElement.addEventListener("webglcontextlost", listener);
      return () => renderer.domElement.removeEventListener("webglcontextlost", listener);
    },
  });

  let contextLost = false;
  renderer.domElement.addEventListener("webglcontextlost", () => {
    contextLost = true;
  });
  renderer.domElement.addEventListener("webglcontextrestored", () => {
    contextLost = false;
  });
  let visibilityChanges = 0;
  const countVisibility = () => visibilityChanges++;
  document.addEventListener("visibilitychange", countVisibility);
  let controller: AbortController | null = null;
  /** Bumped by each preview and each run, so a preview that resolves late knows it is stale. */
  let previewToken = 0;
  /** The preview on the stage now, if any: a run takes it off before measuring. */
  let activePreview: ProfiledObject | null = null;
  /** How to undo each preview's host, once, when that preview ends. */
  const previewHosts = new Map<ProfiledObject, () => void>();
  /** Every preview host not yet undone, including previews whose factory is still building. */
  const previewHostTracker = createHostTracker();
  let lastExport: string | null = null;
  let results: CaseResult[] = [];

  function applySize(): void {
    const [width, height] = value("resolution").split("x").map(Number) as [number, number];
    renderer.setPixelRatio(qualities[value("quality") as keyof typeof qualities] ?? 1);
    renderer.setSize(width, height, false);
    runner.camera.aspect = width / height;
    runner.camera.updateProjectionMatrix();
  }

  function environment(): ProfilerEnvironmentInfo {
    const gl = renderer.getContext();
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const size = renderer.getSize(new THREE.Vector2());
    return {
      userAgent: navigator.userAgent,
      gpu: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : null,
      width: size.x,
      height: size.y,
      pixelRatio: renderer.getPixelRatio(),
      quality: value("quality"),
    };
  }

  function listCases(): void {
    const fieldset = part("cases");
    fieldset.querySelectorAll("label").forEach((label) => label.remove());
    for (const id of profilingCases.names()) {
      const label = document.createElement("label");
      label.innerHTML = `<input type="checkbox" checked /> `;
      label.querySelector("input")!.value = id;
      label.append(`${profilingCases.get(id).label} (${profilingCases.get(id).family})`);
      fieldset.append(label);
    }
    if (!profilingCases.names().length)
      part("status").textContent = "No profiling cases are registered yet.";
    part("coverage").textContent = describeCoverage(catalogCoverage(expectedCatalogs));
  }

  function showResults(): void {
    const sorted = sortedByCost(results, value("sort") as keyof typeof costMeasures);
    const cell = (text: string) => {
      const td = document.createElement("td");
      td.textContent = text;
      return td;
    };
    const ms = (n: number | null | undefined) =>
      n === null || n === undefined ? "n/a" : n.toFixed(3);
    part("results").replaceChildren(
      ...sorted.map((result) => {
        const row = document.createElement("tr");
        row.tabIndex = 0;
        row.append(
          cell(result.phase ? `${result.label} (${result.phase})` : result.label),
          cell(result.family),
          // One value per count, in the order run: "1 / 10 / 50".
          cell(result.counts.map(({ count }) => count).join(" / ")),
          cell(result.counts.map(({ set }) => ms(set.gpu?.median)).join(" / ")),
          cell(result.counts.map(({ set }) => ms(set.cpu.median)).join(" / ")),
          cell(`${ms(largestSet(result)?.frame.median)} (${ms(largestSet(result)?.frame.p95)})`),
          // Geometry at every count, so batching and growth show without the export (#741 review).
          cell(result.counts.map(({ set }) => String(set.counts.calls)).join(" / ")),
          cell(result.counts.map(({ set }) => String(set.counts.triangles)).join(" / ")),
          // Creation per count, raw for the whole set (build plus compiling first frame).
          cell(
            result.counts
              .map(({ creation }) => ms(creation.build + creation.firstFrame))
              .join(" / "),
          ),
          // The passes every frame rendered through (#764), and why no relative values if none.
          cell(
            [
              describePipeline(result.pipeline.passes),
              ...(result.baselineUnavailable ? [`no baseline: ${result.baselineUnavailable}`] : []),
            ].join("; "),
          ),
          cell(
            result.leaked.geometries || result.leaked.textures
              ? `${result.leaked.geometries}g ${result.leaked.textures}t`
              : "none",
          ),
        );
        row.addEventListener("click", () => void preview(result.id, result.phase));
        return row;
      }),
    );
  }

  /** Show the selected case's real visual, one object, outside any measurement. */
  async function preview(id: string, phase?: string): Promise<void> {
    if (controller) return;
    playSfx("ui.click");
    const mine = ++previewToken;
    // The case's own host, as a run would draw it (#712), undone when the preview ends.
    // Undone exactly once: by this preview ending, or by a run starting while its factory is
    // still building, whichever comes first (#720 review).
    const undoLights = runner.prepareHost(profilingCases.get(id).host ?? defaultProfilingHost);
    // Its own pipeline too, so a capture look shows current capture data (#764); disposed with
    // the host, whichever way the preview ends.
    let pipeline: ProfilingPipeline | null = null;
    const undoHost = previewHostTracker.track(() => {
      pipeline?.dispose();
      pipeline = null;
      undoLights();
    });
    let one: ProfiledObject;
    try {
      const built = await runner.preparePipeline(profilingCases.get(id));
      if (mine !== previewToken || controller) {
        built.dispose();
        undoHost();
        return;
      }
      pipeline = built;
      one = await profilingCases.get(id).create({ seed: 1, phase });
    } catch (error) {
      undoHost();
      throw error;
    }
    previewHosts.set(one, undoHost);
    // A run started (or another preview) while this one was being built: free it unseen, and
    // leave the run's scene and camera alone (#640 review).
    if (mine !== previewToken || controller) {
      previewHosts.get(one)?.();
      previewHosts.delete(one);
      one.dispose();
      return;
    }
    // A preview still running is replaced: taken off and freed first, never orphaned (#653 review).
    if (activePreview) endPreview(activePreview);
    runner.collection.add(one.object);
    activePreview = one;
    runner.camera.position.set(0, 0, 5);
    runner.camera.lookAt(0, 0, 0);
    // Run it for half a second of real frames before the last one stays on screen: ongoing
    // effects advance through `update`, and contents animated from the render itself (rising
    // bubbles) need real rendered frames (#653 review). A run or another preview cuts it short.
    for (let step = 0; step < previewFrames; step++) {
      if (mine !== previewToken || controller) break;
      one.update?.(1 / 60);
      pipeline?.render({ delta: 1 / 60, reducedMotion: false });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    endPreview(one);
  }

  /** Take a preview off the stage and free it, once, whoever gets there first. */
  function endPreview(one: ProfiledObject): void {
    if (activePreview !== one) return;
    activePreview = null;
    previewHosts.get(one)?.();
    previewHosts.delete(one);
    one.object.removeFromParent();
    one.dispose();
  }

  /** The controls that change what a run measures or how results show, off while one runs. */
  function setSettingsEnabled(enabled: boolean): void {
    for (const control of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      ".profiler-room-controls input, .profiler-room-controls select",
    ))
      control.disabled = !enabled;
  }

  /** The manual path: the checked cases, with the controls' counts and frames. */
  async function run(): Promise<void> {
    playSfx("ui.click");
    const chosen = [...part("cases").querySelectorAll<HTMLInputElement>("input:checked")].map(
      ({ value: id }) => [id, profilingCases.get(id)] as const,
    );
    const { counts, frames } = runSettings(value("counts"), value("frames"));
    part<HTMLInputElement>("counts").value = counts.join(", ");
    part<HTMLInputElement>("frames").value = String(frames);
    await execute(chosen, { counts, frames, warmupFrames: 30, seed: 527 }, expectedCatalogs);
  }

  /** Every case the expected catalogs list that has a registered case, in catalog order. */
  function catalogCases(catalogs: readonly string[]) {
    return catalogs.flatMap((catalog) =>
      (profilingCoverage.has(catalog) ? profilingCoverage.get(catalog)() : [])
        .filter((id) => profilingCases.has(id))
        .map((id) => [id, profilingCases.get(id)] as const),
    );
  }

  /**
   * Measure cases once, through the runner: shared by the manual path and the trait's automatic
   * sweep. Resolves with the version-3 record; a cancel resolves with the partial record.
   */
  async function execute(
    chosen: readonly (readonly [string, ProfilingCase])[],
    settings: Omit<RunOptions, "signal">,
    catalogs: readonly string[],
    outer?: AbortSignal,
  ): Promise<ProfilerExport> {
    previewToken++;
    // A preview still animating leaves the stage now, so it never shares a measured frame.
    if (activePreview) endPreview(activePreview);
    // So do the hosts of previews still being built: the run's own host lights it alone.
    previewHostTracker.releaseAll();
    applySize();
    // The settings a run uses are fixed and recorded as it starts: later changes to the controls
    // affect the next run, never this run's metadata (#640 review).
    const environmentInfo = environment();
    controller = new AbortController();
    const mine = controller;
    outer?.addEventListener("abort", () => mine.abort(), { once: true });
    if (outer?.aborted) mine.abort();
    const options: RunOptions = { ...settings, signal: mine.signal };
    // Every run, manual or automatic, holds the application's rendering when it can, and the
    // record says which it was (#735 review).
    const resumeRendering = capabilities.pauseRendering?.();
    part<HTMLButtonElement>("run").disabled = true;
    part<HTMLButtonElement>("run-all").disabled = true;
    part<HTMLButtonElement>("cancel").disabled = false;
    // Nothing in the room redraws while a run samples (#640 review).
    setSettingsEnabled(false);
    part("status").textContent =
      `Running ${chosen.length} case(s)… GPU timing ${timer.available ? "available" : "unavailable"}.`;
    try {
      const outcome = await runner.run(chosen, options);
      const record = profilerExport(
        outcome,
        options,
        environmentInfo,
        catalogCoverage(catalogs),
        undefined,
        resumeRendering ? "paused" : "shared",
      );
      results = outcome.results;
      lastExport = JSON.stringify(record, null, 2);
      part("status").textContent = describeOutcome(outcome);
      showReport(profilerReport(record));
      part<HTMLButtonElement>("export").disabled = false;
      showResults();
      return record;
    } finally {
      resumeRendering?.();
      if (controller === mine) controller = null;
      setSettingsEnabled(true);
      part<HTMLButtonElement>("run").disabled = false;
      part<HTMLButtonElement>("run-all").disabled = false;
      part<HTMLButtonElement>("cancel").disabled = true;
    }
  }

  /** The end-of-run report (#733): banner, rankings at the largest count, and unit summaries. */
  function showReport(report: ProfilerReport): void {
    const line = (tag: string, text: string) => {
      const element = document.createElement(tag);
      element.textContent = text;
      return element;
    };
    const sections: HTMLElement[] = [
      line("p", `${report.banner.summary} · ${report.banner.coverage}`),
      ...report.banner.notes.map((note) => line("p", note)),
    ];
    for (const ranking of report.rankings) {
      sections.push(
        line("h3", `${ranking.title}${ranking.count ? `, ${ranking.count} instances` : ""}`),
      );
      const list = document.createElement("ol");
      list.append(...ranking.entries.map(({ text }) => line("li", text)));
      sections.push(list);
    }
    sections.push(
      line(
        "p",
        report.byUnit.map(({ kind, rows }) => `${rows.length} ${kind} case(s)`).join(" · "),
      ),
    );
    // How each case's cost grew from the smallest count to the largest (#741 review).
    sections.push(line("h3", "Growth by case"));
    const growth = document.createElement("ul");
    growth.append(...report.rows.map(({ growthText }) => line("li", growthText)));
    sections.push(growth);
    part("report").replaceChildren(...sections);
  }

  /** The status line for a finished, cancelled or stopped run. */
  function describeOutcome(outcome: RunResult): string {
    const ending = outcome.aborted
      ? `Stopped (${outcome.aborted})`
      : outcome.cancelled
        ? "Cancelled"
        : "Done";
    const notes = [
      outcome.failures.length
        ? `failed: ${outcome.failures.map(({ id, phase, kind, reason }) => `${phase ? `${id}:${phase}` : id} (${kind}: ${reason})`).join(", ")}`
        : "",
      outcome.notRun.length ? `not run: ${outcome.notRun.length}` : "",
      outcome.invalidated.length
        ? `invalidated (tab hidden): ${outcome.invalidated.join(", ")}`
        : "",
    ].filter(Boolean);
    return `${ending}: ${outcome.results.length} result(s); GPU timing ${outcome.gpuTiming}${notes.length ? `; ${notes.join("; ")}` : ""}.`;
  }

  /** Run-all requests from the button; the composing trait decides what they do. */
  const runAllListeners = new Set<() => void>();

  part("run").addEventListener("click", () => void run());
  part("run-all").addEventListener("click", () => {
    playSfx("ui.click");
    for (const listener of runAllListeners) listener();
  });
  part("cancel").addEventListener("click", () => {
    playSfx("ui.back");
    controller?.abort();
  });
  part("sort").addEventListener("change", () => {
    playSfx("ui.click");
    if (!controller) showResults();
  });
  part("export").addEventListener("click", () => {
    if (!lastExport) return;
    playSfx("ui.click");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([lastExport], { type: "application/json" }));
    link.download = `poker-blocks-profile-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

  const room: ProfilerRoom = {
    show({ backTo, catalogs }) {
      expectedCatalogs = [...catalogs];
      part<HTMLAnchorElement>("back").href = modeLink(
        gameModeFor(backTo),
        window.location.href,
      ).href;
      root.hidden = false;
      applySize();
      listCases();
    },
    hide() {
      controller?.abort();
      root.hidden = true;
    },
    orchestration() {
      // The trait's scope over this room's narrow capabilities: it measures what it is asked,
      // and pauses its previews while it does; it never decides when a run starts.
      return createDevProfilerScope<ProfilerExport>(
        {
          sweep: (request, signal) =>
            execute(
              catalogCases(request.catalogs),
              {
                counts: request.counts,
                frames: request.frames,
                warmupFrames: request.warmupFrames,
                seed: request.seed,
                timeoutMs: request.timeoutMs,
              },
              request.catalogs,
              signal,
            ),
          // Cancelled in the room, stopped by a lost context, or cut short by the trait.
          partial: (record) => record.cancelled || record.aborted !== null,
          // Isolated only when the application's rendering can actually be paused; otherwise
          // the capability is absent and the delivery says the frames were shared.
          ...(capabilities.pauseRendering
            ? {
                isolate: () => {
                  previewToken++;
                  if (activePreview) endPreview(activePreview);
                  previewHostTracker.releaseAll();
                  // The run itself holds the application's rendering (see execute).
                  return () => {};
                },
              }
            : {}),
        },
        room,
      );
    },
    onRunAll(listener) {
      runAllListeners.add(listener);
      return () => runAllListeners.delete(listener);
    },
    showReport(delivery) {
      // The on-screen sink: the table and status are already this run's; mark a partial one.
      if (delivery.partial) part("status").textContent += " (partial)";
      if (!delivery.isolated) part("status").textContent += " Not isolated from other rendering.";
    },
    dispose() {
      controller?.abort();
      document.removeEventListener("visibilitychange", countVisibility);
      timer.dispose();
      reflections.dispose();
      renderer.dispose();
      root.remove();
    },
  };
  return room;
}
