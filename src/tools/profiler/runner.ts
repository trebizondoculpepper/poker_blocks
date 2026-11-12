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

/** The parts of a renderer the runner uses (a THREE.WebGLRenderer fits). */
export type ProfilerRenderer = {
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  info: {
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
  set: SampleSet;
  relative: { gpu: number | null; cpu: number };
};

/** The standard sweep's counts (doc/automatic-profiling.md, "Sweep and representative host"). */
export const standardCounts: readonly number[] = [1, 10, 50];

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
  /** Milliseconds to build one object and to render its first (compiling) frame. */
  creation: { build: number; firstFrame: number };
  baseline: SampleSet;
  /** One record per requested count, in the order run (#721): never fixed one/collection slots. */
  counts: CountResult[];
  /** Resources left after disposal compared with before the case: positive means a leak. */
  leaked: { geometries: number; textures: number };
};

export type RunResult = {
  results: CaseResult[];
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

export function createProfilerRunner(env: ProfilerEnvironment) {
  const scene = new THREE.Scene();
  // No lights of its own: each case's registered host lights the scene (#712).
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);

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

  const rendererCounts = (): RendererCounts => ({
    calls: env.renderer.info.render.calls,
    triangles: env.renderer.info.render.triangles,
    geometries: env.renderer.info.memory.geometries,
    textures: env.renderer.info.memory.textures,
    programs: env.renderer.info.programs?.length ?? 0,
  });

  function frame(objects: readonly ProfiledObject[], dt: number): number {
    const start = env.now();
    for (const each of objects) each.update?.(dt);
    env.timer.begin();
    try {
      env.renderer.render(scene, camera);
    } finally {
      // A render that throws still closes its query (#625 review).
      env.timer.end();
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
        const one = await profile.create({ seed: options.seed + index, phase });
        one.object.position.copy(positions[index]!);
        scene.add(one.object);
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
    try {
      return {
        ...(await measureCase(id, profile, phase, options, check, invalidated, label, counts)),
        host,
      };
    } finally {
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
  ): Promise<Omit<CaseResult, "host">> {
    // Each count has its own fixed-grid framing (doc/automatic-profiling.md, "Sweep and
    // representative host"): a fixed-viewport collection test, so per-object screen area shrinks
    // as the count grows. The empty baseline is taken once per case, in this case's host.
    frameFor(1);
    await warm([], options, check);
    const baseline = await measured(`${label}/baseline`, [], options, check, invalidated);

    const less = (a: number | undefined, b: number | undefined) =>
      a === undefined || b === undefined ? null : a - b;
    const measuredCounts: CountResult[] = [];
    let creation: CaseResult["creation"] | null = null;
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
        // Creation is reported for one object: the first count's build, divided out.
        creation ??= { build: buildTime / count, firstFrame };
        await warm(objects, options, check);
        const set = await measured(`${label}/${count}`, objects, options, check, invalidated);
        remove(objects);
        // Freed: a cancel during the next build must not free them again.
        objects = [];
        measuredCounts.push({
          count,
          framing,
          set,
          // Baseline-relative estimates: not additive per-object costs.
          relative: {
            gpu: less(set.gpu?.median, baseline.gpu?.median),
            cpu: set.cpu.median - baseline.cpu.median,
          },
        });
      }
      frame([], 0);
      // Leaks across a repeated cycle: by now anything a case creates once and shares (a cached
      // texture, a compiled program) already exists, so one more build, render and dispose of a
      // single object should leave the counts where they were.
      const before = rendererCounts();
      const again = await build(profile, 1, options, phase, check);
      frame(again, 0);
      remove(again);
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
        creation: creation ?? { build: 0, firstFrame: 0 },
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
    prepareHost,
    /** Measure these cases one at a time, in order. */
    async run(
      cases: readonly (readonly [string, ProfilingCase])[],
      options: RunOptions,
    ): Promise<RunResult> {
      const results: CaseResult[] = [];
      const invalidated: string[] = [];
      const check = () => {
        if (options.signal?.aborted) throw new Cancelled();
      };
      signal = options.signal;
      try {
        for (const [id, profile] of cases)
          for (const { name: phase, sampling } of profile.phases ?? [steadyPhase]) {
            // Cosmetic randomness (stars, bubbles, grass) repeats exactly for a seed (#653 review).
            const restore = useCosmeticRandom(seededStream(options.seed));
            try {
              const result = await runCase(id, profile, phase, options, check, invalidated);
              results.push({ ...result, sampling });
            } finally {
              restore();
            }
          }
      } catch (error) {
        if (!(error instanceof Cancelled)) throw error;
        return { results, cancelled: true, gpuTiming: timing(), invalidated };
      }
      return { results, cancelled: false, gpuTiming: timing(), invalidated };
    },
  };

  function timing(): RunResult["gpuTiming"] {
    return env.timer.available ? "available" : "unavailable";
  }
}
