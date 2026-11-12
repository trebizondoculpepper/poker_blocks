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
import { setReflectionEnvironment } from "../../visual/block-appearance";
import { playSfx } from "../../audio/sfx";
import { gameModeFor, modeLink } from "../../game-modes";
import "./all-cases";
import { catalogCoverage, describeCoverage, profilingCases, type ProfiledObject } from "./cases";
import { costMeasures, profilerExport, sortedByCost, type ProfilerEnvironmentInfo } from "./export";
import { createGpuTimer } from "./gpu-timer";
import { createProfilerRunner, type CaseResult, type RunOptions } from "./runner";
import "./room.css";

/** Bounded positive whole numbers from the count and frames inputs; defaults when unreadable. */
export function runSettings(countText: string, framesText: string) {
  const whole = (text: string, fallback: number, min: number, max: number) => {
    const number = Math.round(Number(text));
    return Number.isFinite(number) && number >= min ? Math.min(max, number) : fallback;
  };
  return { count: whole(countText, 25, 1, 200), frames: whole(framesText, 120, 10, 2000) };
}

/** The room's composed configuration: where Back goes, and the catalogs it must cover (#710). */
export type ProfilerRoomConfig = { backTo: string; catalogs: readonly string[] };
export type ProfilerRoom = {
  show(config: ProfilerRoomConfig): void;
  hide(): void;
  dispose(): void;
};

/** Frames a preview advances before it is shown. */
const previewFrames = 30;

/** Render qualities offered: the pixel ratio each one uses. */
const qualities = { low: 1, standard: 1.5, high: 2 };

export function createProfilerRoom(host: HTMLElement): ProfilerRoom {
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
      <label>Collection <input data-part="count" type="number" min="1" max="200" value="25" /></label>
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
        <button type="button" data-part="run">Run selected</button>
        <button type="button" data-part="cancel" disabled>Cancel</button>
        <button type="button" data-part="export" disabled>Export JSON</button>
      </div>
      <p data-part="status" role="status"></p>
      <div data-part="coverage" class="profiler-room-coverage"></div>
    </aside>
    <div class="profiler-room-main">
      <div class="profiler-room-stage" data-part="stage"></div>
      <table class="profiler-room-results">
        <thead><tr><th>Case</th><th>Family</th><th>Objects</th><th>GPU ms</th><th>CPU ms</th><th>Frame ms (p95)</th><th>Calls</th><th>Triangles</th><th>Create ms</th><th>Leak</th></tr></thead>
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
    hidden: () => document.hidden,
    visibilityChanges: () => visibilityChanges,
  });

  let visibilityChanges = 0;
  const countVisibility = () => visibilityChanges++;
  document.addEventListener("visibilitychange", countVisibility);
  let controller: AbortController | null = null;
  /** Bumped by each preview and each run, so a preview that resolves late knows it is stale. */
  let previewToken = 0;
  /** The preview on the stage now, if any: a run takes it off before measuring. */
  let activePreview: ProfiledObject | null = null;
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
          cell(String(result.collection.objects)),
          cell(ms(result.collection.gpu?.median)),
          cell(ms(result.collection.cpu.median)),
          cell(`${ms(result.collection.frame.median)} (${ms(result.collection.frame.p95)})`),
          cell(String(result.collection.counts.calls)),
          cell(String(result.collection.counts.triangles)),
          cell(ms(result.creation.build + result.creation.firstFrame)),
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
    const one = await profilingCases.get(id).create({ seed: 1, phase });
    // A run started (or another preview) while this one was being built: free it unseen, and
    // leave the run's scene and camera alone (#640 review).
    if (mine !== previewToken || controller) {
      one.dispose();
      return;
    }
    // A preview still running is replaced: taken off and freed first, never orphaned (#653 review).
    if (activePreview) endPreview(activePreview);
    runner.scene.add(one.object);
    activePreview = one;
    runner.camera.position.set(0, 0, 5);
    runner.camera.lookAt(0, 0, 0);
    // Run it for half a second of real frames before the last one stays on screen: ongoing
    // effects advance through `update`, and contents animated from the render itself (rising
    // bubbles) need real rendered frames (#653 review). A run or another preview cuts it short.
    for (let step = 0; step < previewFrames; step++) {
      if (mine !== previewToken || controller) break;
      one.update?.(1 / 60);
      renderer.render(runner.scene, runner.camera);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    endPreview(one);
  }

  /** Take a preview off the stage and free it, once, whoever gets there first. */
  function endPreview(one: ProfiledObject): void {
    if (activePreview !== one) return;
    activePreview = null;
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

  async function run(): Promise<void> {
    playSfx("ui.click");
    const chosen = [...part("cases").querySelectorAll<HTMLInputElement>("input:checked")].map(
      ({ value: id }) => [id, profilingCases.get(id)] as const,
    );
    previewToken++;
    // A preview still animating leaves the stage now, so it never shares a measured frame.
    if (activePreview) endPreview(activePreview);
    applySize();
    // The settings a run uses are fixed and recorded as it starts: later changes to the controls
    // affect the next run, never this run's metadata (#640 review).
    const settings = environment();
    const { count, frames } = runSettings(value("count"), value("frames"));
    part<HTMLInputElement>("count").value = String(count);
    part<HTMLInputElement>("frames").value = String(frames);
    controller = new AbortController();
    const options: RunOptions = {
      count,
      frames,
      warmupFrames: 30,
      seed: 527,
      signal: controller.signal,
    };
    part<HTMLButtonElement>("run").disabled = true;
    part<HTMLButtonElement>("cancel").disabled = false;
    // Nothing in the room redraws while a run samples (#640 review).
    setSettingsEnabled(false);
    part("status").textContent =
      `Running ${chosen.length} case(s)… GPU timing ${timer.available ? "available" : "unavailable"}.`;
    try {
      const outcome = await runner.run(chosen, options);
      results = outcome.results;
      lastExport = JSON.stringify(
        profilerExport(outcome, options, settings, catalogCoverage(expectedCatalogs)),
        null,
        2,
      );
      part("status").textContent =
        `${outcome.cancelled ? "Cancelled" : "Done"}: ${outcome.results.length} result(s); GPU timing ${outcome.gpuTiming}${outcome.invalidated.length ? `; invalidated (tab hidden): ${outcome.invalidated.join(", ")}` : ""}.`;
      part<HTMLButtonElement>("export").disabled = false;
      showResults();
    } finally {
      controller = null;
      setSettingsEnabled(true);
      part<HTMLButtonElement>("run").disabled = false;
      part<HTMLButtonElement>("cancel").disabled = true;
    }
  }

  part("run").addEventListener("click", () => void run());
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

  return {
    show({ backTo, catalogs }) {
      expectedCatalogs = [...catalogs];
      part<HTMLAnchorElement>("back").href = modeLink(
        gameModeFor(backTo),
        window.location.href,
      ).href;
      root.hidden = false;
      // Blocks built here reflect the room's own environment, as in the object browser.
      setReflectionEnvironment(reflections.texture);
      applySize();
      listCases();
    },
    hide() {
      controller?.abort();
      root.hidden = true;
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
}
