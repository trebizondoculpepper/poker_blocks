/**
 * The profiler's measurement runner (#527, #618). For each registered case it builds the object,
 * warms it until shaders compile (reported separately as creation cost), then samples an empty
 * baseline, one object and a fixed-size collection. Each sample set records GPU time where the
 * timer is available, CPU update and submission time, frame-time median and p95, and renderer
 * counts. Runs are bounded and cancellable, a sample set taken while the tab was hidden is
 * discarded and retaken, and resource counts are compared across repeats to show leaks.
 *
 * Everything that touches the browser (renderer, timer, clock, frames, visibility) is passed in,
 * so the runner itself is tested with fakes.
 */
import * as THREE from "three";
import "./hosts";
import {
  defaultProfilingHost,
  oneBlock,
  profilingHosts,
  type ProfiledObject,
  type ProfilingCase,
  type ProfilingPhase,
  type ProfilingUnit,
} from "./cases";

/** A case without phases is sampled once, as one steady phase with no name. */
const steadyPhase: { name: string | undefined; sampling: ProfilingPhase["sampling"] } = {
  name: undefined,
  sampling: "steady",
};
import type { GpuTimer } from "./gpu-timer";
import {
  createPipeline,
  profilingPasses,
  type PassHandler,
  type PassReference,
  type ProfilingPipeline,
} from "./pipelines";
import type { Registry } from "../../core/registry";
import type { PassRenderer } from "../../visual/render-pass";
import { useCosmeticRandom } from "../../visual/block-effects";

/** A small seeded stream (mulberry32): the same numbers for the same seed, run after run. */
export function seededStream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type RendererCounts = {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
};

/** The parts of a renderer the runner and its passes use (a THREE.WebGLRenderer fits). */
export type ProfilerRenderer = PassRenderer & {
  info: {
    /** Off while a frame renders, so its counts add up across every pass (#764). */
    autoReset: boolean;
    reset(): void;
    render: { calls: number; triangles: number };
    memory: { geometries: number; textures: number };
    programs?: readonly unknown[] | null;
  };
};

export type ProfilerEnvironment = {
  renderer: ProfilerRenderer;
  timer: GpuTimer;
  /** Milliseconds, monotonic. */
  now(): number;
  /** Resolves on the next animation frame. */
  nextFrame(): Promise<void>;
  /**
   * Reflections made by this environment's own renderer, for reflective looks (#712); none when
   * it can't make them (a test).
   */
  reflections?(): THREE.Texture;
  /** Whether the renderer's WebGL context has been lost (#722); the run stops if so. */
  contextLost?(): boolean;
  /**
   * Hear the moment the context is lost, so the active case stops at once rather than measuring
   * a renderer that no longer draws (#726 review). Returns how to stop listening.
   */
  onContextLost?(listener: () => void): () => void;
  /** Whether the page is hidden now (its timing is not trustworthy). */
  hidden(): boolean;
  /**
   * How many times the page's visibility has changed so far: a set during which it changed was
   * interrupted, even if the page is visible at every check (#625 review).
   */
  visibilityChanges(): number;
};

export type RunOptions = {
  /** The collection sizes measured, in order; the standard [1, 10, 50] when omitted. */
  counts?: readonly number[];
  /** Frames sampled per set. */
  frames: number;
  /** Frames rendered before sampling, to compile shaders and settle. */
  warmupFrames: number;
  seed: number;
  /** Milliseconds one case or phase may take before it is recorded as timed out (#722). */
  timeoutMs?: number;
  /** Retakes allowed for a set spoiled by the tab being hidden. */
  retries?: number;
  signal?: AbortSignal;
};

export type Distribution = { median: number; p95: number; samples: number };

export type SampleSet = {
  objects: number;
  gpu: Distribution | null;
  cpu: Distribution;
  frame: Distribution;
  counts: RendererCounts;
  /** Disjoint or invalid GPU results dropped. */
  gpuRejected: number;
};

/** One count's measurement and its baseline-relative estimate (not an additive per-object cost). */
/**
 * How a count was framed: its square grid and the camera's distance and field of view. A fixed
 * viewport fits each count, so per-object screen area shrinks as the count grows; compare a
 * series as a fixed-viewport collection test, not as constant per-object cost.
 */
export type Framing = { gridSide: number; cameraDistance: number; fov: number };

export type CountResult = {
  count: number;
  framing: Framing;
  /** Milliseconds to build this count's objects and render their first (compiling) frame. */
  creation: { build: number; firstFrame: number };
  set: SampleSet;
  /** Null when the case's baseline can't be matched (`CaseResult.baselineUnavailable`). */
  relative: { gpu: number | null; cpu: number | null };
};

/**
 * The passes a case was rendered through (#764), so comparisons are inspectable: its declared
 * pass references in order, how many, and the milliseconds spent building them (first-use setup,
 * kept apart from the sampled frames).
 */
export type PipelineRecord = {
  passes: readonly PassReference[];
  passCount: number;
  /** Null for a record from before pipelines, which never timed one. */
  setup: number | null;
};

/** The standard sweep's counts (doc/automatic-profiling.md, "Sweep and representative host"). */
export const standardCounts: readonly number[] = [1, 10, 50];

/** How long one case or phase may run, by default (doc/automatic-profiling.md): 120 seconds. */
export const defaultCaseTimeout = 120_000;

export type CaseResult = {
  id: string;
  family: string;
  label: string;
  phase?: string;
  /** What one instance is, its representative variant, and how its phase was sampled (#711). */
  unit: ProfilingUnit;
  variant?: string;
  sampling: ProfilingPhase["sampling"];
  /** The registered host it was drawn in (#712). */
  host: string;
  /** Its render pipeline (#764): every sample, the baseline included, rendered through it. */
  pipeline: PipelineRecord;
  baseline: SampleSet;
  /** Why baseline-relative values are withheld, when a pass can't render an empty collection. */
  baselineUnavailable?: string;
  /** One record per requested count, in the order run (#721): never fixed one/collection slots. */
  counts: CountResult[];
  /** Resources left after disposal compared with before the case: positive means a leak. */
  leaked: { geometries: number; textures: number };
};

/** A case or phase that produced no result, and why (#722): recorded, never a zero-cost row. */
export type CaseFailure = {
  id: string;
  phase?: string;
  kind: "error" | "timeout" | "context-lost";
  reason: string;
};

export type RunResult = {
  results: CaseResult[];
  /** Cases that failed or timed out; the run went on with the next independent case. */
  failures: CaseFailure[];
  /** Why the run stopped before every case ran, other than a cancel: a lost WebGL context. */
  aborted: "context-lost" | null;
  /** Cases and phases never started because the run stopped (cancelled or aborted). */
  notRun: string[];
  cancelled: boolean;
  gpuTiming: "available" | "unavailable";
  /** Sets that stayed spoiled by a hidden tab after every retry. */
  invalidated: string[];
};

/** Median and 95th percentile (nearest rank). */
export function distribution(values: readonly number[]): Distribution {
  if (!values.length) return { median: 0, p95: 0, samples: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
  return { median: rank(0.5), p95: rank(0.95), samples: sorted.length };
}

/** A fixed square grid, centred, so collections cover a comparable area. */
export function gridPositions(count: number, spacing = 1.4): THREE.Vector3[] {
  const side = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, index) => {
    const x = (index % side) - (side - 1) / 2;
    const y = Math.floor(index / side) - (side - 1) / 2;
    return new THREE.Vector3(x * spacing, -y * spacing, 0);
  });
}

class Cancelled extends Error {}

export function createProfilerRunner(
  env: ProfilerEnvironment,
  passes: Pick<Registry<PassHandler>, "has" | "get"> = profilingPasses,
) {
  const scene = new THREE.Scene();
  // No lights of its own: each case's registered host lights the scene (#712).
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
  /** Every profiled object is built under this root, and nothing else is: passes hide it. */
  const collection = new THREE.Group();
  scene.add(collection);

  /** Build a case's declared pipeline in its host, on this runner's renderer, scene and camera. */
  function preparePipeline(profile: ProfilingCase): Promise<ProfilingPipeline> {
    return createPipeline(
      profile.pipeline ?? [],
      {
        renderer: env.renderer,
        scene,
        camera,
        root: collection,
        host: profile.host ?? defaultProfilingHost,
      },
      passes,
    );
  }

  /** The pipeline frames render through: the running case's, else the main render alone. */
  const mainOnly: Pick<ProfilingPipeline, "render"> = {
    render: () => env.renderer.render(scene, camera),
  };
  let pipeline = mainOnly;

  /** The running run's cancel signal, so frame waits can be abandoned when it fires. */
  let signal: AbortSignal | undefined;

  /**
   * The next animation frame, or a cancel, whichever comes first: frames can stop while the tab
   * is hidden, and a cancel must still reach cleanup (#625 review).
   */
  function waitFrame(): Promise<void> {
    if (signal?.aborted) return Promise.reject(new Cancelled());
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(new Cancelled());
      signal?.addEventListener("abort", onAbort, { once: true });
      void env.nextFrame().then(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, reject);
    });
  }

  /**
   * A factory's promise, or the current signal's abort, whichever comes first (#722): a factory
   * that never settles can't hold a run past its deadline. One that settles later is disposed.
   */
  function untilAborted<T extends { dispose(): void }>(made: T | Promise<T>): Promise<T> {
    const current = signal;
    if (!current) return Promise.resolve(made);
    if (current.aborted) {
      void Promise.resolve(made).then(
        (late) => late.dispose(),
        () => {},
      );
      return Promise.reject(new Cancelled());
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        void Promise.resolve(made).then(
          (late) => late.dispose(),
          () => {},
        );
        reject(new Cancelled());
      };
      current.addEventListener("abort", onAbort, { once: true });
      Promise.resolve(made).then(
        (one) => {
          current.removeEventListener("abort", onAbort);
          // Already aborted: the abort handler owns disposing it, exactly once.
          if (!current.aborted) resolve(one);
        },
        (error: unknown) => {
          current.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }

  const rendererCounts = (): RendererCounts => ({
    calls: env.renderer.info.render.calls,
    triangles: env.renderer.info.render.triangles,
    geometries: env.renderer.info.memory.geometries,
    textures: env.renderer.info.memory.textures,
    programs: env.renderer.info.programs?.length ?? 0,
  });

  /**
   * One frame: the objects' updates, then every declared pass and the main render, all inside the
   * CPU time and the GPU query (#764). The renderer's counts are reset once here and add up
   * across the passes, then its own setting is put back.
   */
  function frame(objects: readonly ProfiledObject[], dt: number): number {
    const start = env.now();
    for (const each of objects) each.update?.(dt);
    const { info } = env.renderer;
    const autoReset = info.autoReset;
    info.autoReset = false;
    info.reset();
    env.timer.begin();
    try {
      pipeline.render({ delta: dt, reducedMotion: false });
    } finally {
      // A render that throws still closes its query (#625 review).
      env.timer.end();
      info.autoReset = autoReset;
    }
    return env.now() - start;
  }

  /** Fit the camera so the collection's grid fills a fixed share of the view. */
  function frameFor(count: number): Framing {
    const side = Math.ceil(Math.sqrt(Math.max(1, count)));
    const distance = 3 + side * 2.2;
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    return { gridSide: side, cameraDistance: distance, fov: camera.fov };
  }

  async function sample(
    objects: readonly ProfiledObject[],
    options: RunOptions,
    check: () => void,
  ): Promise<{ set: SampleSet; spoiled: boolean }> {
    // Queries still in flight from warm-up or an earlier set never enter this one (#625 review).
    env.timer.poll();
    env.timer.discard();
    const rejectedBefore = env.timer.rejected;
    const cpu: number[] = [];
    const frames: number[] = [];
    const gpu: number[] = [];
    let spoiled = env.hidden();
    const changesBefore = env.visibilityChanges();
    let last = env.now();
    let setCounts = rendererCounts();
    for (let i = 0; i < options.frames; i++) {
      check();
      await waitFrame();
      const now = env.now();
      frames.push(now - last);
      last = now;
      cpu.push(frame(objects, frames.at(-1)! / 1000));
      if (i === 0) setCounts = rendererCounts();
      gpu.push(...env.timer.poll());
      if (env.hidden() || env.visibilityChanges() !== changesBefore) spoiled = true;
    }
    // Collect the queries still in flight, a bounded number of frames.
    for (let i = 0; i < 30 && env.timer.pending > 0; i++) {
      check();
      await waitFrame();
      gpu.push(...env.timer.poll());
    }
    // Any still unanswered after the bounded drain are dropped, not left for the next set.
    env.timer.discard();
    // A cancel during the last set's drain still cancels (#625 review).
    check();
    return {
      spoiled,
      set: {
        objects: objects.length,
        gpu: env.timer.available && gpu.length ? distribution(gpu) : null,
        cpu: distribution(cpu),
        frame: distribution(frames),
        counts: setCounts,
        gpuRejected: env.timer.rejected - rejectedBefore,
      },
    };
  }

  async function measured(
    name: string,
    objects: readonly ProfiledObject[],
    options: RunOptions,
    check: () => void,
    invalidated: string[],
  ): Promise<SampleSet> {
    const retries = options.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      const { set, spoiled } = await sample(objects, options, check);
      if (!spoiled) return set;
      if (attempt >= retries) {
        invalidated.push(name);
        return set;
      }
    }
  }

  async function build(
    profile: ProfilingCase,
    count: number,
    options: RunOptions,
    phase: string | undefined,
    check: () => void = () => {},
  ): Promise<ProfiledObject[]> {
    const positions = gridPositions(count);
    const made: ProfiledObject[] = [];
    try {
      for (let index = 0; index < count; index++) {
        // A cancel stops the build between creations, not after the whole collection (#625).
        check();
        const one = await untilAborted(profile.create({ seed: options.seed + index, phase }));
        one.object.position.copy(positions[index]!);
        collection.add(one.object);
        made.push(one);
      }
      check();
    } catch (error) {
      remove(made);
      throw error;
    }
    return made;
  }

  function remove(objects: readonly ProfiledObject[]): void {
    for (const each of objects) {
      each.object.removeFromParent();
      each.dispose();
    }
  }

  async function warm(objects: readonly ProfiledObject[], options: RunOptions, check: () => void) {
    for (let i = 0; i < options.warmupFrames; i++) {
      check();
      await waitFrame();
      frame(objects, 1 / 60);
    }
    env.timer.poll();
    env.timer.discard();
  }

  async function runCase(
    id: string,
    profile: ProfilingCase,
    phase: string | undefined,
    options: RunOptions,
    check: () => void,
    invalidated: string[],
  ): Promise<CaseResult> {
    const label = phase ? `${id}:${phase}` : id;
    const counts = options.counts ?? standardCounts;
    // The case's host sets the scene up before anything is built, and is undone after (#712).
    const host = profile.host ?? defaultProfilingHost;
    const undoHost = prepareHost(host);
    let built: ProfilingPipeline | null = null;
    try {
      // Its passes are built once, in its host, and every set renders through them: the
      // baseline too, so it is matched (doc/profiler-render-passes.md, "Timing and baseline").
      const setupStart = env.now();
      built = await untilAborted(preparePipeline(profile));
      const setup = env.now() - setupStart;
      pipeline = built;
      const result = await measureCase(
        id,
        profile,
        phase,
        options,
        check,
        invalidated,
        label,
        counts,
        built.baselineUnavailable,
      );
      return {
        ...result,
        host,
        pipeline: { passes: built.passes, passCount: built.passes.length, setup },
        ...(built.baselineUnavailable ? { baselineUnavailable: built.baselineUnavailable } : {}),
      };
    } finally {
      pipeline = mainOnly;
      // Its targets go whether the case finished, failed, timed out or was cancelled.
      built?.dispose();
      undoHost();
    }
  }

  /** Prepare a registered host on the run's scene; returns how to undo it. */
  function prepareHost(host: string): () => void {
    return profilingHosts.get(host).prepare({ scene, reflections: env.reflections?.() ?? null });
  }

  async function measureCase(
    id: string,
    profile: ProfilingCase,
    phase: string | undefined,
    options: RunOptions,
    check: () => void,
    invalidated: string[],
    label: string,
    counts: readonly number[],
    baselineUnavailable: string | null,
  ): Promise<Omit<CaseResult, "host" | "pipeline">> {
    // Each count has its own fixed-grid framing (doc/automatic-profiling.md, "Sweep and
    // representative host"): a fixed-viewport collection test, so per-object screen area shrinks
    // as the count grows. The empty baseline is taken once per case, in this case's host.
    frameFor(1);
    await warm([], options, check);
    const baseline = await measured(`${label}/baseline`, [], options, check, invalidated);

    // An unmatched baseline gives no relative values at all, never a main-only subtraction.
    const less = (a: number | undefined, b: number | undefined) =>
      a === undefined || b === undefined || baselineUnavailable ? null : a - b;
    const measuredCounts: CountResult[] = [];
    let objects: ProfiledObject[] = [];
    try {
      for (const count of counts) {
        const framing = frameFor(count);
        const buildStart = env.now();
        objects = await build(profile, count, options, phase, check);
        const buildTime = env.now() - buildStart;
        // The compiling first frame is inside the cleanup, so a case that throws here is still
        // removed and freed (#625 review).
        const firstStart = env.now();
        frame(objects, 0);
        const firstFrame = env.now() - firstStart;
        await warm(objects, options, check);
        const set = await measured(`${label}/${count}`, objects, options, check, invalidated);
        remove(objects);
        // Freed: a cancel during the next build must not free them again.
        objects = [];
        measuredCounts.push({
          count,
          framing,
          // Raw, for the whole set: building all `count` objects and their compiling first
          // frame. Shared setup and compilation make it non-additive, so it is never divided.
          creation: { build: buildTime, firstFrame },
          set,
          // Baseline-relative estimates: not additive per-object costs.
          relative: {
            gpu: less(set.gpu?.median, baseline.gpu?.median),
            cpu: less(set.cpu.median, baseline.cpu.median),
          },
        });
      }
      frame([], 0);
      // Leaks across a repeated cycle: by now anything a case creates once and shares (a cached
      // texture, a compiled program) already exists, so one more build, render and dispose of a
      // single object should leave the counts where they were.
      const before = rendererCounts();
      const again = await build(profile, 1, options, phase, check);
      // Removed and freed whatever happens: a throw here must not leave it in the shared scene
      // for the next case to measure (#726 review).
      try {
        frame(again, 0);
      } finally {
        remove(again);
      }
      frame([], 0);
      const after = rendererCounts();
      return {
        id,
        family: profile.family,
        label: profile.label,
        ...(phase ? { phase } : {}),
        unit: profile.unit ?? oneBlock,
        ...(profile.variant ? { variant: profile.variant } : {}),
        sampling: "steady" as ProfilingPhase["sampling"],
        baseline,
        counts: measuredCounts,
        leaked: {
          geometries: after.geometries - before.geometries,
          textures: after.textures - before.textures,
        },
      };
    } finally {
      remove(objects);
    }
  }

  return {
    scene,
    camera,
    /** The root every profiled object goes under. */
    collection,
    prepareHost,
    preparePipeline,
    /** Measure these cases one at a time, in order. */
    async run(
      cases: readonly (readonly [string, ProfilingCase])[],
      options: RunOptions,
    ): Promise<RunResult> {
      const results: CaseResult[] = [];
      const failures: CaseFailure[] = [];
      const invalidated: string[] = [];
      const queue = cases.flatMap(([id, profile]) =>
        (profile.phases ?? [steadyPhase]).map(({ name: phase, sampling }) => ({
          id,
          profile,
          phase,
          sampling,
        })),
      );
      const labelOf = ({ id, phase }: { id: string; phase?: string }) =>
        phase ? `${id}:${phase}` : id;
      const finish = (from: number, ending: Pick<RunResult, "cancelled" | "aborted">) => ({
        results,
        failures,
        notRun: queue.slice(from).map(labelOf),
        gpuTiming: timing(),
        invalidated,
        ...ending,
      });
      for (const [index, entry] of queue.entries()) {
        if (options.signal?.aborted) return finish(index, { cancelled: true, aborted: null });
        // A lost context can't measure anything more: stop, and say so (#722).
        if (env.contextLost?.())
          return finish(index, { cancelled: false, aborted: "context-lost" });
        // Each case or phase gets its own deadline, combined with the run's cancel.
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(), options.timeoutMs ?? defaultCaseTimeout);
        // Losing the context mid-case stops this case at once, and the run after it.
        let lostDuring = false;
        const stopListening = env.onContextLost?.(() => {
          lostDuring = true;
          deadline.abort();
        });
        const lost = () => lostDuring || (env.contextLost?.() ?? false);
        signal = options.signal
          ? AbortSignal.any([options.signal, deadline.signal])
          : deadline.signal;
        const caseSignal = signal;
        const check = () => {
          if (caseSignal.aborted || lost()) throw new Cancelled();
        };
        // Cosmetic randomness (stars, bubbles, grass) repeats exactly for a seed (#653 review).
        const restore = useCosmeticRandom(seededStream(options.seed));
        try {
          const result = await runCase(
            entry.id,
            entry.profile,
            entry.phase,
            options,
            check,
            invalidated,
          );
          // Measured on a lost context: not a result. Recorded, and the run stops here.
          if (lost()) {
            failures.push(contextLostFailure(entry));
            return finish(index + 1, { cancelled: false, aborted: "context-lost" });
          }
          results.push({ ...result, sampling: entry.sampling });
        } catch (error) {
          if (options.signal?.aborted) return finish(index, { cancelled: true, aborted: null });
          if (lost()) {
            failures.push(contextLostFailure(entry));
            return finish(index + 1, { cancelled: false, aborted: "context-lost" });
          }
          // The case's own resources were released by its cleanup; independent cases go on.
          failures.push({
            id: entry.id,
            ...(entry.phase ? { phase: entry.phase } : {}),
            ...(deadline.signal.aborted
              ? {
                  kind: "timeout" as const,
                  reason: `exceeded ${options.timeoutMs ?? defaultCaseTimeout} ms`,
                }
              : {
                  kind: "error" as const,
                  reason: error instanceof Error ? error.message : String(error),
                }),
          });
        } finally {
          clearTimeout(timer);
          stopListening?.();
          restore();
        }
      }
      return finish(queue.length, { cancelled: false, aborted: null });
    },
  };

  function contextLostFailure(entry: { id: string; phase?: string }): CaseFailure {
    return {
      id: entry.id,
      ...(entry.phase ? { phase: entry.phase } : {}),
      kind: "context-lost",
      reason: "the WebGL context was lost while this case ran",
    };
  }

  function timing(): RunResult["gpuTiming"] {
    return env.timer.available ? "available" : "unavailable";
  }
}
