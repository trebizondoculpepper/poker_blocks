import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { Registry } from "../../core/registry";
import { uncoveredCases, type ProfilingCase } from "./cases";
import { createGpuTimer, unavailableTimer, type GpuTimer } from "./gpu-timer";
import {
  createProfilerRunner,
  distribution,
  gridPositions,
  type ProfilerEnvironment,
  type RunOptions,
} from "./runner";

/** A fake browser: each frame advances the clock by 16 ms; rendering costs 1 ms per object. */
function fakeEnvironment(timer: GpuTimer = unavailableTimer(), hiddenFrames = new Set<number>()) {
  let clock = 0;
  let frames = 0;
  let objects = 0;
  const memory = { geometries: 0, textures: 0 };
  const env: ProfilerEnvironment = {
    renderer: {
      render(scene) {
        objects = scene.children.filter((child) => child.userData.profiled).length;
        clock += objects;
      },
      info: {
        get render() {
          return { calls: objects, triangles: objects * 12 };
        },
        memory,
        programs: [],
      },
    },
    timer,
    now: () => clock,
    nextFrame: async () => {
      frames++;
      clock += 16;
    },
    hidden: () => hiddenFrames.has(frames),
    visibilityChanges: () => 0,
  };
  return { env, memory, frameCount: () => frames };
}

function testCase(memory: { geometries: number }, leak = false): ProfilingCase {
  return {
    family: "test",
    label: "Test cube",
    defaultCount: 4,
    create() {
      memory.geometries++;
      const object = new THREE.Object3D();
      object.userData.profiled = true;
      return {
        object,
        dispose() {
          if (!leak) memory.geometries--;
        },
      };
    },
  };
}

const options: RunOptions = { frames: 10, warmupFrames: 3, seed: 1 };

describe("profiler statistics (#618)", () => {
  it("gives the median and nearest-rank 95th percentile", () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(distribution(values)).toEqual({ median: 10, p95: 19, samples: 20 });
    expect(distribution([])).toEqual({ median: 0, p95: 0, samples: 0 });
  });

  it("lays a collection out on a centred square grid", () => {
    const grid = gridPositions(4, 2);
    expect(grid.map(({ x, y }) => [x, y])).toEqual([
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ]);
  });
});

describe("the profiler runner (#618)", () => {
  it("samples a baseline, one object and the collection, and finds no leak", async () => {
    const { env, memory } = fakeEnvironment();
    const runner = createProfilerRunner(env);
    const run = await runner.run([["cube", testCase(memory)]], options);
    const [result] = run.results;
    expect(run.cancelled).toBe(false);
    expect(result!.baseline.objects).toBe(0);
    expect(result!.one.objects).toBe(1);
    expect(result!.collection.objects).toBe(4);
    expect(result!.one.cpu.samples).toBe(10);
    // Rendering costs 1 ms per object in the fake, so the collection's CPU time is higher.
    expect(result!.collection.cpu.median).toBeGreaterThan(result!.one.cpu.median);
    expect(result!.relative.oneCpu).toBe(1);
    expect(result!.leaked.geometries).toBe(0);
    expect(runner.scene.children.some((child) => child.userData.profiled)).toBe(false);
  });

  it("reports a leak when a case does not free what it made", async () => {
    const { env, memory } = fakeEnvironment();
    const run = await createProfilerRunner(env).run([["leaky", testCase(memory, true)]], options);
    // One object built and disposed in the repeated cycle, and not freed.
    expect(run.results[0]!.leaked.geometries).toBe(1);
  });

  it("labels GPU timing unavailable rather than using frame time", async () => {
    const { env, memory } = fakeEnvironment();
    const run = await createProfilerRunner(env).run([["cube", testCase(memory)]], options);
    expect(run.gpuTiming).toBe("unavailable");
    expect(run.results[0]!.one.gpu).toBeNull();
    expect(run.results[0]!.relative.oneGpu).toBeNull();
  });

  it("uses GPU results when available and drops disjoint ones", async () => {
    let rejected = 0;
    let open = 0;
    const ready: number[] = [];
    const timer: GpuTimer = {
      available: true,
      begin() {},
      end() {
        open++;
        // Every third query is spoiled by a disjoint event.
        if (open % 3 === 0) rejected++;
        else ready.push(2);
      },
      poll: () => ready.splice(0),
      discard() {},
      get pending() {
        return 0;
      },
      get rejected() {
        return rejected;
      },
      dispose() {},
    };
    const { env, memory } = fakeEnvironment(timer);
    const run = await createProfilerRunner(env).run([["cube", testCase(memory)]], options);
    const one = run.results[0]!.one;
    expect(run.gpuTiming).toBe("available");
    expect(one.gpu?.median).toBe(2);
    expect(one.gpuRejected).toBeGreaterThan(0);
    expect(one.gpu!.samples + one.gpuRejected).toBe(10);
  });

  it("retakes a set spoiled by a hidden tab, and records one that stays spoiled", async () => {
    const { env, memory } = fakeEnvironment(unavailableTimer(), new Set([5]));
    const run = await createProfilerRunner(env).run([["cube", testCase(memory)]], options);
    expect(run.invalidated).toEqual([]);

    const always = fakeEnvironment();
    always.env.hidden = () => true;
    const spoiled = await createProfilerRunner(always.env).run(
      [["cube", testCase(always.memory)]],
      { ...options, retries: 1 },
    );
    expect(spoiled.invalidated).toContain("cube/baseline");
  });

  it("stops when cancelled, disposing what it built", async () => {
    const { env, memory, frameCount } = fakeEnvironment();
    const controller = new AbortController();
    const next = env.nextFrame.bind(env);
    env.nextFrame = async () => {
      await next();
      if (frameCount() === 20) controller.abort();
    };
    const run = await createProfilerRunner(env).run(
      [
        ["a", testCase(memory)],
        ["b", testCase(memory)],
      ],
      { ...options, signal: controller.signal },
    );
    expect(run.cancelled).toBe(true);
    expect(run.results).toEqual([]);
    expect(memory.geometries).toBe(0);
  });

  it("runs each phase of a transient effect as its own result", async () => {
    const { env, memory } = fakeEnvironment();
    const phased = { ...testCase(memory), phases: ["idle", "exit"] };
    const run = await createProfilerRunner(env).run([["effect", phased]], options);
    expect(run.results.map(({ phase }) => phase)).toEqual(["idle", "exit"]);
  });
});

describe("profiler coverage (#618)", () => {
  it("names registered appearances with no case, never skipping them", () => {
    const cases = new Registry<ProfilingCase>("case");
    cases.register("material:wood", testCase({ geometries: 0 }));
    const coverage = new Registry<() => readonly string[]>("coverage");
    coverage.register("material", () => ["material:wood", "material:steel"]);
    coverage.register("menu", () => []);
    expect(uncoveredCases(cases, coverage)).toEqual([
      { family: "material", missing: ["material:steel"] },
    ]);
  });
});

/** A timer whose results arrive two frames after they were taken, tagged by what was drawn. */
function delayedTimer(env: { objectsDrawn: () => number; frame: () => number }) {
  const inFlight: { ready: number; value: number; dropped: boolean }[] = [];
  const timer: GpuTimer = {
    available: true,
    begin() {},
    end() {
      // GPU time equals the number of objects drawn, so a warm-up frame's value is recognisable.
      inFlight.push({ ready: env.frame() + 2, value: env.objectsDrawn() + 0.5, dropped: false });
    },
    poll() {
      const done = inFlight.filter(({ ready }) => ready <= env.frame());
      inFlight.splice(0, done.length);
      return done.filter(({ dropped }) => !dropped).map(({ value }) => value);
    },
    discard() {
      inFlight.forEach((entry) => (entry.dropped = true));
    },
    get pending() {
      return inFlight.filter(({ dropped }) => !dropped).length;
    },
    rejected: 0,
    dispose() {},
  };
  return timer;
}

describe("GPU results stay with their own set (#625 review)", () => {
  it("never counts warm-up or another set's late results", async () => {
    let drawn = 0;
    const { env, memory, frameCount } = fakeEnvironment();
    const render = env.renderer.render.bind(env.renderer);
    env.renderer.render = (scene, camera) => {
      drawn = scene.children.filter((child) => child.userData.profiled).length;
      render(scene, camera);
    };
    env.timer = delayedTimer({ objectsDrawn: () => drawn, frame: frameCount });
    const run = await createProfilerRunner(env).run([["cube", testCase(memory)]], options);
    const [result] = run.results;
    // Each set holds exactly its own frames: no warm-up values, nothing from the set before.
    expect(result!.baseline.gpu).toEqual({ median: 0.5, p95: 0.5, samples: 10 });
    expect(result!.one.gpu).toEqual({ median: 1.5, p95: 1.5, samples: 10 });
    expect(result!.collection.gpu).toEqual({ median: 4.5, p95: 4.5, samples: 10 });
  });
});

describe("the GPU timer (#625 review)", () => {
  it("rejects a query in flight during a disjoint event, even if it is answered later", () => {
    const ext = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
    let disjoint = false;
    let available = false;
    const gl = {
      QUERY_RESULT_AVAILABLE: 3,
      QUERY_RESULT: 4,
      getExtension: () => ext,
      createQuery: () => ({}),
      beginQuery() {},
      endQuery() {},
      deleteQuery() {},
      getParameter: (name: number) => name === ext.GPU_DISJOINT_EXT && disjoint,
      getQueryParameter: (_query: unknown, name: number) => (name === 3 ? available : 2_000_000),
    } as unknown as WebGL2RenderingContext;
    const timer = createGpuTimer(gl);
    timer.begin();
    timer.end();
    // The disjoint flag is seen while the query is not yet answered...
    disjoint = true;
    expect(timer.poll()).toEqual([]);
    // ...and has cleared by the time it is: the result is still rejected.
    disjoint = false;
    available = true;
    expect(timer.poll()).toEqual([]);
    expect(timer.rejected).toBe(1);

    timer.begin();
    timer.end();
    expect(timer.poll()).toEqual([2]);
  });

  it("drops discarded queries without counting them as rejected", () => {
    const ext = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
    const gl = {
      QUERY_RESULT_AVAILABLE: 3,
      QUERY_RESULT: 4,
      getExtension: () => ext,
      createQuery: () => ({}),
      beginQuery() {},
      endQuery() {},
      deleteQuery() {},
      getParameter: () => false,
      getQueryParameter: (_query: unknown, name: number) => (name === 3 ? true : 1_000_000),
    } as unknown as WebGL2RenderingContext;
    const timer = createGpuTimer(gl);
    timer.begin();
    timer.end();
    timer.discard();
    expect(timer.pending).toBe(0);
    expect(timer.poll()).toEqual([]);
    expect(timer.rejected).toBe(0);
  });
});

describe("the runner's fairness and cancellation (#625 review)", () => {
  it("sees every set of a case from the same camera position", async () => {
    const { env, memory } = fakeEnvironment();
    const seen = new Set<string>();
    const render = env.renderer.render.bind(env.renderer);
    env.renderer.render = (scene, camera) => {
      seen.add(camera.position.toArray().join(","));
      render(scene, camera);
    };
    await createProfilerRunner(env).run([["cube", testCase(memory)]], options);
    expect(seen.size).toBe(1);
  });

  it("honours a cancel that arrives while the last set's GPU queries drain", async () => {
    const { env, memory, frameCount } = fakeEnvironment();
    const controller = new AbortController();
    let open = 0;
    env.timer = {
      available: true,
      begin() {},
      end() {
        open++;
      },
      // Nothing is ever answered, so every set drains for its full bound.
      poll: () => [],
      discard() {
        open = 0;
      },
      get pending() {
        return open;
      },
      rejected: 0,
      dispose() {},
    };
    const next = env.nextFrame.bind(env);
    // Each set takes 3 warm-up frames, 10 sampled frames and a 30-frame drain: 129 in all. Frame
    // 125 falls inside the last set's drain.
    env.nextFrame = async () => {
      await next();
      if (frameCount() === 125) controller.abort();
    };
    const run = await createProfilerRunner(env).run([["cube", testCase(memory)]], {
      ...options,
      signal: controller.signal,
    });
    expect(run.cancelled).toBe(true);
    expect(run.results).toEqual([]);
  });
});

describe("hidden-tab detection between checks (#625 review)", () => {
  it("retakes a set whose tab was hidden and shown again between two frames", async () => {
    const { env, memory, frameCount } = fakeEnvironment();
    // Hidden for five seconds while one frame was pending, visible again before it resumed.
    let changes = 0;
    const next = env.nextFrame.bind(env);
    const now = env.now.bind(env);
    let paused = 0;
    env.nextFrame = async () => {
      await next();
      if (frameCount() === 8) {
        changes += 2;
        paused = 5000;
      }
    };
    env.now = () => now() + paused;
    env.visibilityChanges = () => changes;
    const run = await createProfilerRunner(env).run([["cube", testCase(memory)]], options);
    // The baseline set (frames 4 to 13) was retaken, so the pause never reaches its timings.
    expect(run.invalidated).toEqual([]);
    expect(run.results[0]!.baseline.frame.p95).toBeLessThan(100);
  });
});

describe("leaks are judged across a repeated cycle", () => {
  it("does not call a resource made once and shared a leak", async () => {
    const { env, memory } = fakeEnvironment();
    let shared = false;
    const sharing: ProfilingCase = {
      ...testCase(memory),
      create(context) {
        // A cache filled on first use and kept, as a shared texture is.
        if (!shared) {
          shared = true;
          memory.geometries++;
        }
        return testCase(memory).create(context);
      },
    };
    const run = await createProfilerRunner(env).run([["shared", sharing]], options);
    expect(run.results[0]!.leaked.geometries).toBe(0);
  });
});

describe("cancelling while a collection is built (#625 review)", () => {
  it("stops creating objects and frees the ones already made", async () => {
    const { env, memory } = fakeEnvironment();
    const controller = new AbortController();
    let created = 0;
    const base = testCase(memory);
    const slow: ProfilingCase = {
      ...base,
      defaultCount: 5,
      async create(context) {
        created++;
        // The collection's first creation: cancel while it is pending.
        if (created === 2) controller.abort();
        return base.create(context);
      },
    };
    const run = await createProfilerRunner(env).run([["slow", slow]], {
      ...options,
      signal: controller.signal,
    });
    expect(run.cancelled).toBe(true);
    // One for the single-object set, one for the collection when the cancel came: no more.
    expect(created).toBe(2);
    expect(memory.geometries).toBe(0);
  });
});

describe("a case that fails on its first frame (#625 review)", () => {
  it("is still removed from the scene and freed", async () => {
    const { env, memory } = fakeEnvironment();
    const base = testCase(memory);
    const failing: ProfilingCase = {
      ...base,
      create(context) {
        const made = base.create(context) as ReturnType<ProfilingCase["create"]> & {
          update?: (dt: number) => void;
        };
        return {
          ...(made as { object: THREE.Object3D; dispose(): void }),
          update() {
            throw new Error("broken case");
          },
        };
      },
    };
    const runner = createProfilerRunner(env);
    await expect(runner.run([["broken", failing]], options)).rejects.toThrow("broken case");
    expect(runner.scene.children.some((child) => child.userData.profiled)).toBe(false);
    expect(memory.geometries).toBe(0);
  });
});
