import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { Registry } from "../../core/registry";
import type { ProfilingCase } from "./cases";
import { passRenderer } from "./fake-pass-renderer";
import { unavailableTimer, type GpuTimer } from "./gpu-timer";
import {
  createPipeline,
  describePipeline,
  resolvePasses,
  type PassHandler,
  type PassReference,
} from "./pipelines";
import { createProfilerRunner, type ProfilerEnvironment, type RunOptions } from "./runner";

/**
 * A renderer that logs every draw and counts like three's: `info.render` adds up per draw and
 * resets at each render unless `autoReset` is off.
 */
function loggingRenderer(log: string[], name = "renderer") {
  const base = passRenderer();
  const info = {
    autoReset: true,
    render: { calls: 0, triangles: 0 },
    memory: { geometries: 0, textures: 0 },
    programs: [] as unknown[],
    reset() {
      info.render.calls = 0;
      info.render.triangles = 0;
    },
  };
  const renderer = {
    ...base,
    info,
    render(scene: THREE.Scene, camera: THREE.Camera) {
      if (info.autoReset) info.reset();
      let drawn = 0;
      scene.traverseVisible((child) => {
        if (child.userData.profiled) drawn++;
      });
      info.render.calls += Math.max(1, drawn);
      info.render.triangles += drawn * 12;
      const target = renderer.getRenderTarget() ? "target" : "screen";
      log.push(`${name}:${target}:${camera.uuid === mainCameraOf.get(renderer) ? "main" : "x"}`);
    },
  };
  return renderer;
}
const mainCameraOf = new WeakMap<object, string>();

/** A synthetic prepass with no material identity: logs, draws once into its own target. */
function synthetic(
  log: string[],
  options: { fail?: boolean; dispose?: () => void; baselineUnavailable?: string } = {},
): PassHandler {
  return {
    provides: ["synthetic"],
    ...(options.baselineUnavailable ? { baselineUnavailable: options.baselineUnavailable } : {}),
    create({ renderer, own }, config) {
      const target = own(new THREE.WebGLRenderTarget(4, 4));
      return {
        render({ scene, camera, hide }) {
          log.push(`pass:${String(config.tag ?? "")}:hidden=${String(!hide.visible)}`);
          renderer.setRenderTarget(target);
          renderer.setClearColor(0xff0000, 0.25);
          camera.layers.set(5);
          scene.background = new THREE.Color(0x00ff00);
          renderer.render(scene, camera);
          if (options.fail) throw new Error("pass failed");
        },
        dispose() {
          log.push(`dispose:${String(config.tag ?? "")}`);
          options.dispose?.();
        },
      };
    },
  };
}

function environment(log: string[], name = "renderer", timer: GpuTimer = unavailableTimer()) {
  let clock = 0;
  const renderer = loggingRenderer(log, name);
  const env: ProfilerEnvironment = {
    renderer,
    timer,
    now: () => clock,
    nextFrame: async () => {
      clock += 16;
    },
    hidden: () => false,
    visibilityChanges: () => 0,
  };
  return { env, renderer };
}

function profiled(pipeline: readonly PassReference[]): ProfilingCase {
  return {
    family: "test",
    label: "Test cube",
    pipeline,
    create() {
      const object = new THREE.Object3D();
      object.userData.profiled = true;
      return { object, dispose() {} };
    },
  };
}

const options: RunOptions = { frames: 4, warmupFrames: 1, seed: 1, counts: [1, 10, 50] };

describe("profiling render pipelines (#764)", () => {
  it("runs the declared passes in order, then the main render exactly once", async () => {
    const log: string[] = [];
    const passes = new Registry<PassHandler>("pass");
    passes.register("first", synthetic(log));
    passes.register("second", { ...synthetic(log), requires: ["synthetic"] });
    const renderer = loggingRenderer(log);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    mainCameraOf.set(renderer, camera.uuid);
    const pipeline = await createPipeline(
      [
        { handler: "first", config: { tag: "a" } },
        { handler: "second", config: { tag: "b" } },
      ],
      { renderer, scene, camera, root: new THREE.Group(), host: "board" },
      passes,
    );
    pipeline.render({ delta: 1 / 60, reducedMotion: false });
    expect(log).toEqual([
      "pass:a:hidden=false",
      "renderer:target:main",
      "pass:b:hidden=false",
      "renderer:target:main",
      "renderer:screen:main",
    ]);
    pipeline.dispose();
    expect(log.slice(-2)).toEqual(["dispose:b", "dispose:a"]);
  });

  it("rejects an unregistered pass or an unmet requirement before anything is built", () => {
    const passes = new Registry<PassHandler>("pass");
    passes.register("needs", { ...synthetic([]), provides: [], requires: ["capture"] });
    expect(() => resolvePasses([{ handler: "missing" }], passes)).toThrow(/no registered/);
    expect(() => resolvePasses([{ handler: "needs" }], passes)).toThrow(/needs capture/);
  });

  it("names each pass and its configuration, then the main render", () => {
    expect(describePipeline([])).toBe("main render");
    expect(describePipeline([{ handler: "opticsCapture", config: { backend: "calmWater" } }])).toBe(
      "opticsCapture(backend=calmWater) → main render",
    );
  });

  it("puts the renderer, camera and scene back after a pass that throws, and skips the main render", async () => {
    const log: string[] = [];
    const passes = new Registry<PassHandler>("pass");
    passes.register("broken", synthetic(log, { fail: true }));
    const renderer = loggingRenderer(log);
    renderer.setClearColor(0x123456, 0.5);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const pipeline = await createPipeline(
      [{ handler: "broken" }],
      { renderer, scene, camera, root: new THREE.Group(), host: "board" },
      passes,
    );
    expect(() => pipeline.render({ delta: 0, reducedMotion: false })).toThrow(/pass failed/);
    expect(renderer.getRenderTarget()).toBeNull();
    expect(renderer.getClearColor(new THREE.Color()).getHex()).toBe(0x123456);
    expect(renderer.getClearAlpha()).toBe(0.5);
    expect(camera.layers.mask).toBe(1);
    expect(scene.background).toBeNull();
    expect(log.filter((entry) => entry.endsWith(":screen:main"))).toEqual([]);
  });

  it("times every pass inside the frame's CPU time and GPU query, and adds up their counts", async () => {
    const log: string[] = [];
    let open = false;
    const timer: GpuTimer = {
      ...unavailableTimer(),
      begin() {
        open = true;
        log.push("begin");
      },
      end() {
        open = false;
        log.push("end");
      },
    };
    const { env, renderer } = environment(log, "renderer", timer);
    const draws: boolean[] = [];
    const render = renderer.render.bind(renderer);
    renderer.render = (scene, camera) => {
      draws.push(open);
      render(scene, camera);
    };
    const passes = new Registry<PassHandler>("pass");
    passes.register("synthetic", synthetic(log));
    const runner = createProfilerRunner(env, passes);
    mainCameraOf.set(renderer, runner.camera.uuid);
    const run = await runner.run([["cube", profiled([{ handler: "synthetic" }])]], {
      ...options,
      counts: [10],
    });
    // Every draw, pass or main, happened inside a bracket.
    expect(draws.length).toBeGreaterThan(0);
    expect(draws.every(Boolean)).toBe(true);
    const [result] = run.results;
    // The pass drew the 10 objects, then the main render drew them again: both counted.
    expect(result!.counts[0]!.set.counts.calls).toBe(20);
    expect(result!.counts[0]!.set.counts.triangles).toBe(240);
    // The renderer's own reset setting is back.
    expect(renderer.info.autoReset).toBe(true);
    expect(result!.pipeline).toMatchObject({ passes: [{ handler: "synthetic" }], passCount: 1 });
  });

  it("samples the baseline through the same pipeline, at 1, 10 and 50", async () => {
    const log: string[] = [];
    const { env } = environment(log);
    const passes = new Registry<PassHandler>("pass");
    passes.register("synthetic", synthetic(log));
    const runner = createProfilerRunner(env, passes);
    const run = await runner.run([["cube", profiled([{ handler: "synthetic" }])]], options);
    const [result] = run.results;
    expect(result!.counts.map(({ count, set }) => [count, set.objects])).toEqual([
      [1, 1],
      [10, 10],
      [50, 50],
    ]);
    // The empty collection still ran its pass: a matched baseline, with relative values.
    expect(result!.baseline.counts.calls).toBe(2);
    expect(result!.counts.every(({ relative }) => relative.cpu !== null)).toBe(true);
    expect(result!.baselineUnavailable).toBeUndefined();
  });

  it("withholds relative values, with the reason, when a pass has no meaningful empty baseline", async () => {
    const log: string[] = [];
    const { env } = environment(log);
    const passes = new Registry<PassHandler>("pass");
    passes.register("synthetic", synthetic(log, { baselineUnavailable: "needs a backdrop" }));
    const run = await createProfilerRunner(env, passes).run(
      [["cube", profiled([{ handler: "synthetic" }])]],
      options,
    );
    const [result] = run.results;
    expect(result!.baselineUnavailable).toBe("needs a backdrop");
    expect(
      result!.counts.every(({ relative }) => relative.cpu === null && relative.gpu === null),
    ).toBe(true);
  });

  it("disposes the pipeline when a case fails, and records the failure", async () => {
    const log: string[] = [];
    const { env } = environment(log);
    const passes = new Registry<PassHandler>("pass");
    let disposed = 0;
    passes.register("broken", synthetic(log, { fail: true, dispose: () => disposed++ }));
    const run = await createProfilerRunner(env, passes).run(
      [["cube", profiled([{ handler: "broken" }])]],
      options,
    );
    expect(run.failures).toMatchObject([{ id: "cube", kind: "error", reason: "pass failed" }]);
    expect(disposed).toBe(1);
  });

  it("fails a case whose pipeline doesn't resolve, without timing anything", async () => {
    const log: string[] = [];
    const { env } = environment(log);
    const run = await createProfilerRunner(env, new Registry<PassHandler>("pass")).run(
      [["cube", profiled([{ handler: "unregistered" }])]],
      options,
    );
    expect(run.failures).toMatchObject([{ id: "cube", kind: "error" }]);
    expect(log).toEqual([]);
  });

  it("disposes a pass that arrives after its case was cancelled", async () => {
    const log: string[] = [];
    const { env } = environment(log);
    const passes = new Registry<PassHandler>("pass");
    let arrive: () => void = () => {};
    let disposed = 0;
    passes.register("slow", {
      create: () =>
        new Promise((resolve) => {
          arrive = () => resolve({ render() {}, dispose: () => disposed++ });
        }),
    });
    const controller = new AbortController();
    const running = createProfilerRunner(env, passes).run(
      [["cube", profiled([{ handler: "slow" }])]],
      { ...options, signal: controller.signal },
    );
    await Promise.resolve();
    controller.abort();
    const run = await running;
    expect(run.cancelled).toBe(true);
    arrive();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disposed).toBe(1);
  });

  it("keeps two renderers' passes to their own renderer and camera", async () => {
    const log: string[] = [];
    const seen: string[] = [];
    const passes = new Registry<PassHandler>("pass");
    passes.register("scoped", {
      create: ({ renderer: owner, camera: own }) => ({
        render({ renderer, camera }) {
          seen.push(String(renderer === owner && camera === own));
        },
        dispose() {},
      }),
    });
    const one = environment(log, "one");
    const two = environment(log, "two");
    const first = createProfilerRunner(one.env, passes);
    const second = createProfilerRunner(two.env, passes);
    const recipe = profiled([{ handler: "scoped" }]);
    await Promise.all([
      first.run([["cube", recipe]], { ...options, counts: [1] }),
      second.run([["cube", recipe]], { ...options, counts: [1] }),
    ]);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((each) => each === "true")).toBe(true);
    expect(log.some((entry) => entry.startsWith("one:"))).toBe(true);
    expect(log.some((entry) => entry.startsWith("two:"))).toBe(true);
  });
});
