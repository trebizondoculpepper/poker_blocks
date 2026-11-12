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

// One object and a small collection: the same sets as the standard sweep, at test speed.
const options: RunOptions = { frames: 10, warmupFrames: 3, seed: 1, counts: [1, 4] };

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
  it("samples a baseline and each requested count, and finds no leak", async () => {
    const { env, memory } = fakeEnvironment();
    const runner = createProfilerRunner(env);
    const run = await runner.run([["cube", testCase(memory)]], options);
    const [result] = run.results;
    expect(run.cancelled).toBe(false);
    expect(result!.baseline.objects).toBe(0);
    expect(result!.counts[0]!.set.objects).toBe(1);
    expect(result!.counts[1]!.set.objects).toBe(4);
    expect(result!.counts[0]!.set.cpu.samples).toBe(10);
    // Rendering costs 1 ms per object in the fake, so the collection's CPU time is higher.
    expect(result!.counts[1]!.set.cpu.median).toBeGreaterThan(result!.counts[0]!.set.cpu.median);
    expect(result!.counts[0]!.relative.cpu).toBe(1);
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
    expect(run.results[0]!.counts[0]!.set.gpu).toBeNull();
    expect(run.results[0]!.counts[0]!.relative.gpu).toBeNull();
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
    const one = run.results[0]!.counts[0]!.set;
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
    const phased = {
      ...testCase(memory),
      phases: [
        { name: "idle", sampling: "steady" as const },
        { name: "exit", sampling: "restarting" as const },
      ],
    };
    const run = await createProfilerRunner(env).run([["effect", phased]], options);
    expect(run.results.map(({ phase }) => phase)).toEqual(["idle", "exit"]);
  });

  it("records each row's unit, variant and phase sampling (#711)", async () => {
    const { env, memory } = fakeEnvironment();
    const word = {
      ...testCase(memory),
      unit: { kind: "group" as const, size: 4 },
      variant: "the word Play",
      phases: [
        { name: "idle", sampling: "steady" as const },
        { name: "exit", sampling: "restarting" as const },
      ],
    };
    const plain = testCase(memory);
    const run = await createProfilerRunner(env).run(
      [
        ["word", word],
        ["plain", plain],
      ],
      options,
    );
    expect(run.results.map(({ unit, variant, sampling }) => ({ unit, variant, sampling }))).toEqual(
      [
        { unit: { kind: "group", size: 4 }, variant: "the word Play", sampling: "steady" },
        { unit: { kind: "group", size: 4 }, variant: "the word Play", sampling: "restarting" },
        { unit: { kind: "block", size: 1 }, variant: undefined, sampling: "steady" },
      ],
    );
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
    expect(result!.counts[0]!.set.gpu).toEqual({ median: 1.5, p95: 1.5, samples: 10 });
    expect(result!.counts[1]!.set.gpu).toEqual({ median: 4.5, p95: 4.5, samples: 10 });
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
  it("frames each count for itself, from one fixed viewport, and records the framing (#721)", async () => {
    // doc/automatic-profiling.md: each count gets its fixed-grid framing; per-object screen area
    // shrinks as the count grows, so the framing is recorded with every count.
    const { env, memory } = fakeEnvironment();
    const run = await createProfilerRunner(env).run([["cube", testCase(memory)]], {
      ...options,
      counts: [1, 4, 9],
    });
    const framings = run.results[0]!.counts.map(({ framing }) => framing);
    expect(framings.map(({ gridSide }) => gridSide)).toEqual([1, 2, 3]);
    const distances = framings.map(({ cameraDistance }) => cameraDistance);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(new Set(distances).size).toBe(3);
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
    // Recorded as a failure, not thrown: later cases still run (#722).
    const run = await runner.run([["broken", failing]], options);
    expect(run.failures).toEqual([{ id: "broken", kind: "error", reason: "broken case" }]);
    expect(runner.scene.children.some((child) => child.userData.profiled)).toBe(false);
    expect(memory.geometries).toBe(0);
  });
});

describe("GPU queries stay balanced when rendering fails (#625 review)", () => {
  it("ends the query a throwing render began", async () => {
    const { env, memory } = fakeEnvironment();
    let open = 0;
    env.timer = { ...unavailableTimer(), begin: () => void open++, end: () => void open-- };
    let renders = 0;
    const render = env.renderer.render.bind(env.renderer);
    env.renderer.render = (scene, camera) => {
      // The first frame with an object in it fails.
      if (scene.children.some((child) => child.userData.profiled) && ++renders === 1)
        throw new Error("render failed");
      render(scene, camera);
    };
    // Recorded as the case's failure, not thrown (#722); the query is still closed.
    const run = await createProfilerRunner(env).run([["cube", testCase(memory)]], options);
    expect(run.failures).toEqual([{ id: "cube", kind: "error", reason: "render failed" }]);
    expect(open).toBe(0);
  });

  it("closes a query still open when the timer is disposed", () => {
    const ext = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
    const calls: string[] = [];
    const gl = {
      QUERY_RESULT_AVAILABLE: 3,
      QUERY_RESULT: 4,
      getExtension: () => ext,
      createQuery: () => ({}),
      beginQuery: () => void calls.push("begin"),
      endQuery: () => void calls.push("end"),
      deleteQuery: () => void calls.push("delete"),
      getParameter: () => false,
      getQueryParameter: () => false,
    } as unknown as WebGL2RenderingContext;
    const timer = createGpuTimer(gl);
    timer.begin();
    timer.dispose();
    expect(calls).toEqual(["begin", "end", "delete"]);
  });
});

describe("a cancel while frames are suspended (#625 review)", () => {
  it("reaches cleanup without waiting for another frame", async () => {
    const { env, memory, frameCount } = fakeEnvironment();
    const controller = new AbortController();
    const next = env.nextFrame.bind(env);
    env.nextFrame = async () => {
      // Frames stop once the single object is built, as when the tab is hidden.
      if (memory.geometries > 0 && frameCount() > 20) return new Promise<void>(() => {});
      return next();
    };
    const running = createProfilerRunner(env).run([["cube", testCase(memory)]], {
      ...options,
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    const run = await running;
    expect(run.cancelled).toBe(true);
    expect(memory.geometries).toBe(0);
  });
});

describe("cosmetic randomness is fixed by the run seed (#653 review)", () => {
  it("gives a case the same random workload on every run, and restores the source after", async () => {
    const { cosmeticRandom } = await import("../../visual/block-effects");
    const drawn = async () => {
      const { env, memory } = fakeEnvironment();
      const values: number[] = [];
      const base = testCase(memory);
      const animated: ProfilingCase = {
        ...base,
        create(context) {
          const made = base.create(context) as { object: THREE.Object3D; dispose(): void };
          values.push(cosmeticRandom());
          return { ...made, update: () => void values.push(cosmeticRandom()) };
        },
      };
      await createProfilerRunner(env).run([["animated", animated]], options);
      return values;
    };
    const first = await drawn();
    expect(first.length).toBeGreaterThan(10);
    expect(await drawn()).toEqual(first);
    // Outside a run, cosmetic randomness is ordinary again.
    expect(cosmeticRandom()).not.toBe(first[0]);
  });
});

describe("representative hosts (#712)", () => {
  it("prepares the case's own registered host before building, undoes it after, and records it", async () => {
    const { profilingHosts } = await import("./cases");
    const { env, memory } = fakeEnvironment();
    const reflections = new THREE.Texture();
    env.reflections = () => reflections;
    const calls: string[] = [];
    let given: THREE.Texture | null = null;
    if (!profilingHosts.has("test.studio"))
      profilingHosts.register("test.studio", {
        label: "Test studio",
        prepare: ({ reflections: owned }) => {
          given = owned;
          calls.push("prepare");
          return () => calls.push("undo");
        },
      });
    const base = testCase(memory);
    const studio: ProfilingCase = {
      ...base,
      host: "test.studio",
      create: (context) => {
        calls.push("create");
        return base.create(context);
      },
    };
    const run = await createProfilerRunner(env).run([["studio", studio]], options);
    expect(run.results[0]!.host).toBe("test.studio");
    expect(calls[0]).toBe("prepare");
    expect(calls.at(-1)).toBe("undo");
    expect(calls.filter((call) => call === "prepare")).toHaveLength(1);
    // The reflections are the ones the runner's own environment made.
    expect(given).toBe(reflections);
  });

  it("lights a case without a host as the board is lit, and takes the lights off after", async () => {
    const { env, memory } = fakeEnvironment();
    const runner = createProfilerRunner(env);
    let lightsWhileBuilding = 0;
    const base = testCase(memory);
    const board: ProfilingCase = {
      ...base,
      create: (context) => {
        lightsWhileBuilding = runner.scene.children.filter(
          (child) => (child as THREE.Light).isLight,
        ).length;
        return base.create(context);
      },
    };
    const run = await runner.run([["board", board]], options);
    expect(run.results[0]!.host).toBe("board");
    expect(lightsWhileBuilding).toBeGreaterThan(0);
    expect(runner.scene.children.filter((child) => (child as THREE.Light).isLight)).toEqual([]);
  });
});

describe("the count matrix (#721)", () => {
  it("measures the standard [1, 10, 50] when no counts are given, each keyed by its count", async () => {
    const { env, memory } = fakeEnvironment();
    const { counts: _counts, ...standard } = options;
    const run = await createProfilerRunner(env).run([["cube", testCase(memory)]], standard);
    const [result] = run.results;
    expect(result!.counts.map(({ count, set }) => [count, set.objects])).toEqual([
      [1, 1],
      [10, 10],
      [50, 50],
    ]);
    // GPU timing unavailable stays null for every count, never zero.
    expect(
      result!.counts.every(({ set, relative }) => set.gpu === null && relative.gpu === null),
    ).toBe(true);
  });

  it("measures exactly the counts asked for, in order", async () => {
    const { env, memory } = fakeEnvironment();
    const run = await createProfilerRunner(env).run([["cube", testCase(memory)]], {
      ...options,
      counts: [2, 3, 7],
    });
    expect(run.results[0]!.counts.map(({ count }) => count)).toEqual([2, 3, 7]);
  });
});

describe("creation timings per count (#723 review)", () => {
  it("keeps each count's raw build and first-frame time, never divided or dropped", async () => {
    const { env, memory } = fakeEnvironment();
    // Building takes 2 ms per object in this case, so each count's build time scales with it.
    const base = testCase(memory);
    let clockShift = 0;
    const now = env.now.bind(env);
    env.now = () => now() + clockShift;
    const slow: ProfilingCase = {
      ...base,
      create: (context) => {
        clockShift += 2;
        return base.create(context);
      },
    };
    const run = await createProfilerRunner(env).run([["slow", slow]], {
      ...options,
      counts: [1, 5],
    });
    const builds = run.results[0]!.counts.map(({ creation }) => creation.build);
    expect(builds).toEqual([2, 10]);
    for (const { creation } of run.results[0]!.counts)
      expect(creation.firstFrame).toBeGreaterThanOrEqual(0);
  });
});

describe("failure isolation, timeouts and context loss (#722)", () => {
  const quick = { ...options, counts: [1] };

  it("records a throwing factory and goes on with the next case", async () => {
    const { env, memory } = fakeEnvironment();
    const runner = createProfilerRunner(env);
    const broken: ProfilingCase = {
      ...testCase(memory),
      create: () => {
        throw new Error("shader failed to compile");
      },
    };
    const run = await runner.run(
      [
        ["broken", broken],
        ["good", testCase(memory)],
      ],
      quick,
    );
    expect(run.failures).toEqual([
      { id: "broken", kind: "error", reason: "shader failed to compile" },
    ]);
    expect(run.results.map(({ id }) => id)).toEqual(["good"]);
    expect(run.cancelled).toBe(false);
    expect(run.aborted).toBeNull();
    expect(runner.scene.children.some((child) => child.userData.profiled)).toBe(false);
  });

  it("times out a case that never finishes building, disposes what it makes late, and goes on", async () => {
    const { env, memory } = fakeEnvironment();
    const runner = createProfilerRunner(env);
    let finishLate: (() => void) | null = null;
    let lateDisposed = false;
    const base = testCase(memory);
    const stuck: ProfilingCase = {
      ...base,
      create: (context) =>
        new Promise((resolve) => {
          finishLate = () =>
            void Promise.resolve(base.create(context)).then((one) =>
              resolve({
                ...one,
                dispose: () => {
                  lateDisposed = true;
                  one.dispose();
                },
              }),
            );
        }),
    };
    const run = await runner.run(
      [
        ["stuck", stuck],
        ["good", testCase(memory)],
      ],
      { ...quick, timeoutMs: 30 },
    );
    expect(run.failures).toEqual([{ id: "stuck", kind: "timeout", reason: "exceeded 30 ms" }]);
    expect(run.results.map(({ id }) => id)).toEqual(["good"]);
    // The factory finally settles after its case gave up: what it made is freed, not leaked.
    finishLate!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lateDisposed).toBe(true);
  });

  it("stops on a lost WebGL context, saying so and listing what never ran", async () => {
    const { env, memory } = fakeEnvironment();
    let lost = false;
    env.contextLost = () => lost;
    const losing: ProfilingCase = {
      ...testCase(memory),
      create: (context) => {
        lost = true;
        return testCase(memory).create(context);
      },
    };
    const run = await createProfilerRunner(env).run(
      [
        ["first", losing],
        ["second", testCase(memory)],
        ["third", testCase(memory)],
      ],
      quick,
    );
    expect(run.aborted).toBe("context-lost");
    // Lost while the first case ran: its measurements are not accepted (#726 review).
    expect(run.results).toEqual([]);
    expect(run.failures).toEqual([
      {
        id: "first",
        kind: "context-lost",
        reason: "the WebGL context was lost while this case ran",
      },
    ]);
    expect(run.notRun).toEqual(["second", "third"]);
  });

  it("stops a case still building the moment the context is lost, not at its timeout", async () => {
    const { env, memory } = fakeEnvironment();
    let lose: (() => void) | null = null;
    env.onContextLost = (listener) => {
      lose = listener;
      return () => {
        lose = null;
      };
    };
    const pending: ProfilingCase = {
      ...testCase(memory),
      create: () => {
        // The context goes while this factory is still building, and it never settles.
        queueMicrotask(() => lose?.());
        return new Promise(() => {});
      },
    };
    const started = Date.now();
    const run = await createProfilerRunner(env).run(
      [
        ["pending", pending],
        ["after", testCase(memory)],
      ],
      { ...quick, timeoutMs: 60_000 },
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(run.aborted).toBe("context-lost");
    expect(run.failures.map(({ id, kind }) => [id, kind])).toEqual([["pending", "context-lost"]]);
    expect(run.notRun).toEqual(["after"]);
  });

  it("keeps the completed results and lists the rest when cancelled", async () => {
    const { env, memory } = fakeEnvironment();
    const controller = new AbortController();
    const cancelling: ProfilingCase = {
      ...testCase(memory),
      create: (context) => {
        controller.abort();
        return testCase(memory).create(context);
      },
    };
    const run = await createProfilerRunner(env).run(
      [
        ["done", testCase(memory)],
        ["cancelling", cancelling],
        ["after", testCase(memory)],
      ],
      { ...quick, signal: controller.signal },
    );
    expect(run.cancelled).toBe(true);
    expect(run.results.map(({ id }) => id)).toEqual(["done"]);
    expect(run.notRun).toEqual(["cancelling", "after"]);
    expect(run.failures).toEqual([]);
  });
});

describe("the leak probe cleans up after itself (#726 review)", () => {
  it("removes the probe object when rendering it throws, so the next case measures clean", async () => {
    const { env, memory } = fakeEnvironment();
    const runner = createProfilerRunner(env);
    let builds = 0;
    const base = testCase(memory);
    // Two builds for counts [1]: the measured set, then the leak probe, whose render throws.
    const probeFails: ProfilingCase = {
      ...base,
      create: (context) => {
        builds++;
        const one = base.create(context) as Awaited<ReturnType<typeof base.create>>;
        if (builds === 2) one.object.userData.explodes = true;
        return one;
      },
    };
    const render = env.renderer.render.bind(env.renderer);
    env.renderer.render = (scene, camera) => {
      if (scene.children.some((child) => child.userData.explodes)) throw new Error("probe failed");
      render(scene, camera);
    };
    const run = await runner.run(
      [
        ["probe", probeFails],
        ["next", testCase(memory)],
      ],
      { ...options, counts: [1] },
    );
    expect(run.failures.map(({ id }) => id)).toEqual(["probe"]);
    expect(runner.scene.children.some((child) => child.userData.profiled)).toBe(false);
    // The next case's baseline drew nothing left over.
    expect(run.results[0]!.baseline.counts.calls).toBe(0);
  });
});
