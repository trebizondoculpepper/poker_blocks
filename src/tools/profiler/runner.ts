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
import type { ProfiledObject, ProfilingCase } from "./cases";
import type { GpuTimer } from "./gpu-timer";

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
  /** Whether the page is hidden now (its timing is not trustworthy). */
  hidden(): boolean;
};

export type RunOptions = {
  /** Objects in the collection; a case's own default when omitted. */
  count?: number;
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

export type CaseResult = {
  id: string;
  family: string;
  label: string;
  phase?: string;
  /** Milliseconds to build one object and to render its first (compiling) frame. */
  creation: { build: number; firstFrame: number };
  baseline: SampleSet;
  one: SampleSet;
  collection: SampleSet;
  /** Baseline-relative estimates (not additive per-object costs). */
  relative: { oneGpu: number | null; oneCpu: number; collectionGpu: number | null };
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
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);

  const counts = (): RendererCounts => ({
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
    env.renderer.render(scene, camera);
    env.timer.end();
    return env.now() - start;
  }

  /** Fit the camera so the collection's grid fills a fixed share of the view. */
  function frameFor(count: number): void {
    const side = Math.ceil(Math.sqrt(Math.max(1, count)));
    camera.position.set(0, 0, 3 + side * 2.2);
    camera.lookAt(0, 0, 0);
  }

  async function sample(
    objects: readonly ProfiledObject[],
    options: RunOptions,
    check: () => void,
  ): Promise<{ set: SampleSet; spoiled: boolean }> {
    env.timer.poll();
    const rejectedBefore = env.timer.rejected;
    const cpu: number[] = [];
    const frames: number[] = [];
    const gpu: number[] = [];
    let spoiled = false;
    let last = env.now();
    let setCounts = counts();
    for (let i = 0; i < options.frames; i++) {
      check();
      await env.nextFrame();
      const now = env.now();
      frames.push(now - last);
      last = now;
      cpu.push(frame(objects, frames.at(-1)! / 1000));
      if (i === 0) setCounts = counts();
      gpu.push(...env.timer.poll());
      if (env.hidden()) spoiled = true;
    }
    // Collect the queries still in flight, a bounded number of frames.
    for (let i = 0; i < 30 && env.timer.pending > 0; i++) {
      await env.nextFrame();
      gpu.push(...env.timer.poll());
    }
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
  ): Promise<ProfiledObject[]> {
    const positions = gridPositions(count);
    const made: ProfiledObject[] = [];
    for (let index = 0; index < count; index++) {
      const one = await profile.create({ seed: options.seed + index, phase });
      one.object.position.copy(positions[index]!);
      scene.add(one.object);
      made.push(one);
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
      await env.nextFrame();
      frame(objects, 1 / 60);
    }
    env.timer.poll();
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
    frameFor(1);
    await warm([], options, check);
    const before = counts();
    const baseline = await measured(`${label}/baseline`, [], options, check, invalidated);

    const buildStart = env.now();
    let objects = await build(profile, 1, options, phase);
    const buildTime = env.now() - buildStart;
    const firstStart = env.now();
    frame(objects, 0);
    const firstFrame = env.now() - firstStart;
    try {
      await warm(objects, options, check);
      const one = await measured(`${label}/one`, objects, options, check, invalidated);
      remove(objects);
      const count = options.count ?? profile.defaultCount ?? 25;
      objects = await build(profile, count, options, phase);
      frameFor(count);
      await warm(objects, options, check);
      const collection = await measured(
        `${label}/collection`,
        objects,
        options,
        check,
        invalidated,
      );
      remove(objects);
      objects = [];
      frame([], 0);
      const after = counts();
      const less = (a: number | undefined, b: number | undefined) =>
        a === undefined || b === undefined ? null : a - b;
      return {
        id,
        family: profile.family,
        label: profile.label,
        ...(phase ? { phase } : {}),
        creation: { build: buildTime, firstFrame },
        baseline,
        one,
        collection,
        relative: {
          oneGpu: less(one.gpu?.median, baseline.gpu?.median),
          oneCpu: one.cpu.median - baseline.cpu.median,
          collectionGpu: less(collection.gpu?.median, baseline.gpu?.median),
        },
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
      try {
        for (const [id, profile] of cases)
          for (const phase of profile.phases ?? [undefined])
            results.push(await runCase(id, profile, phase, options, check, invalidated));
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
