import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { Registry } from "../../core/registry";
import { uncoveredCases, type ProfilingCase } from "./cases";
import { unavailableTimer, type GpuTimer } from "./gpu-timer";
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
    expect(run.results[0]!.leaked.geometries).toBe(5);
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
    const next = env.nextFrame;
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
