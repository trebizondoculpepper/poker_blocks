import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { exitEffects, type ExitContext, type ExitVisual } from "./exit-presentation";
import { createSteppedExits } from "./exit-stepping";
import { createExitPresenter, type ExitPresenter } from "./exit-presentation";
import { createVisualScheduler, visualHandlers } from "../visual-events/scheduler";

// A stand-in effect: runs for `seconds`, logging what happens to it (and any update after it
// has finished, which the runner must never send).
const log: string[] = [];
const contexts: ExitContext[] = [];
exitEffects.register("test-timed", (context, raw) => {
  const { name, seconds } = raw as { name: string; seconds: number };
  contexts.push(context);
  let left = seconds;
  log.push(`${name}:start`);
  return {
    update(delta) {
      if (left <= 0) log.push(`${name}:late-update`);
      left -= delta;
      return left > 0;
    },
    finish: () => void log.push(`${name}:finish`),
    dispose: () => void log.push(`${name}:dispose`),
  };
});
const timed = (name: string, seconds: number, target?: string) => ({
  effect: "test-timed",
  target,
  config: { name, seconds },
});

function visual(): ExitVisual & { parent: THREE.Group; released: ReturnType<typeof vi.fn> } {
  const parent = new THREE.Group();
  const root = new THREE.Group();
  const shell = new THREE.Mesh();
  const flame = new THREE.Mesh();
  root.add(shell, flame);
  parent.add(root);
  const released = vi.fn();
  return { parent, root, shell: [shell], contents: [flame], release: released, released };
}
const snapshot = { blockId: "b1", cell: { x: 0, y: 0, z: 0 } as never };

describe("block exit presentation (#439)", () => {
  it("runs steps in order and a step's effects in parallel, then removes and releases the visual", () => {
    log.length = 0;
    const runner = createSteppedExits();
    const v = visual();
    runner.start(snapshot, v, {
      steps: [{ effects: [timed("a", 0.2), timed("b", 0.4)] }, { effects: [timed("c", 0.1)] }],
    });
    expect(log).toEqual(["a:start", "b:start"]);
    runner.update(0.3);
    expect(log).toEqual(["a:start", "b:start"]);
    runner.update(0.2);
    // A finished naturally and B ran to its end: neither is told to finish, both are disposed.
    expect(log.slice(2)).toEqual(["a:dispose", "b:dispose", "c:start"]);
    expect(v.root.parent).toBe(v.parent);
    runner.update(0.2);
    expect(log.slice(-1)).toEqual(["c:dispose"]);
    expect(v.root.parent).toBeNull();
    expect(v.released).toHaveBeenCalledTimes(1);
    expect(runner.active).toBe(0);
  });

  it("caps every step, so an effect can never make an exit linger", () => {
    log.length = 0;
    const runner = createSteppedExits();
    const v = visual();
    runner.start(snapshot, v, { steps: [{ effects: [timed("slow", 99)], maxSeconds: 0.5 }] });
    runner.update(0.6);
    expect(log).toEqual(["slow:start", "slow:finish", "slow:dispose"]);
    expect(v.released).toHaveBeenCalledTimes(1);
  });

  it("gives each effect its target: the whole block, its shell or its contents", () => {
    contexts.length = 0;
    const runner = createSteppedExits();
    const v = visual();
    runner.start(snapshot, v, {
      steps: [
        {
          effects: [timed("w", 0.1), timed("s", 0.1, "shell"), timed("c", 0.1, "contents")],
        },
      ],
    });
    expect(contexts.map(({ targets }) => targets)).toEqual([[v.root], v.shell, v.contents]);
    expect(contexts[0]!.snapshot).toBe(snapshot);
    runner.dispose();
  });

  it("passes reduced motion to effects", () => {
    contexts.length = 0;
    const runner = createSteppedExits(() => true);
    runner.start(snapshot, visual(), { steps: [{ effects: [timed("r", 0.1)] }] });
    expect(contexts[0]!.reducedMotion).toBe(true);
    runner.dispose();
  });

  it("cancels one exit at once, and disposing the runner cancels the rest, each cleaned up once", () => {
    log.length = 0;
    const runner = createSteppedExits();
    const [one, two] = [visual(), visual()];
    runner.start(snapshot, one, { steps: [{ effects: [timed("x", 5)] }] });
    runner.start({ blockId: "b2" }, two, { steps: [{ effects: [timed("y", 5)] }] });
    runner.cancel("b1");
    expect(log).toEqual(["x:start", "y:start", "x:finish", "x:dispose"]);
    expect(one.released).toHaveBeenCalledTimes(1);
    expect(runner.active).toBe(1);
    runner.dispose();
    runner.dispose();
    expect(log.slice(-2)).toEqual(["y:finish", "y:dispose"]);
    expect(two.released).toHaveBeenCalledTimes(1);
    expect(two.root.parent).toBeNull();
  });

  it("ends at once with no steps, still releasing the visual", () => {
    const runner = createSteppedExits();
    const v = visual();
    runner.start(snapshot, v, { steps: [] });
    expect(v.released).toHaveBeenCalledTimes(1);
    expect(runner.active).toBe(0);
  });

  it("stops updating a parallel effect once it finishes, while the longer one runs on (#477 review)", () => {
    log.length = 0;
    const runner = createSteppedExits();
    runner.start(snapshot, visual(), {
      steps: [{ effects: [timed("short", 0.1), timed("long", 1)] }],
    });
    for (let frame = 0; frame < 8; frame++) runner.update(0.1);
    expect(log).not.toContain("short:late-update");
    expect(log).not.toContain("short:finish");
    runner.dispose();
    expect(log.filter((entry) => entry === "short:dispose")).toHaveLength(1);
  });
});

describe("block exits on the shared scheduler (#549)", () => {
  /** A real scheduler on injected time, presenting exits through its `blockExits` service. */
  function shared(limits: Parameters<typeof createVisualScheduler>[0] = {}) {
    let exits: ExitPresenter | null = null;
    const scheduler = createVisualScheduler({
      ...limits,
      services: {
        get blockExits() {
          return exits!.blockExits;
        },
      },
    });
    exits = createExitPresenter(scheduler);
    let real = 1000;
    scheduler.update(real, true);
    const advance = (ms: number) => scheduler.update((real += ms), true);
    return { scheduler, exits, advance };
  }

  it("registers its handler on the shared scheduler", () => {
    expect(visualHandlers.has("block.exit")).toBe(true);
  });

  it("starts on the next update and runs on the presentation clock, each exit in its own scope", () => {
    log.length = 0;
    const { scheduler, exits, advance } = shared();
    const [one, two] = [visual(), visual()];
    exits.start(snapshot, one, { steps: [{ effects: [timed("one", 0.2)] }] });
    exits.start({ ...snapshot, blockId: "b2" }, two, { steps: [{ effects: [timed("two", 0.5)] }] });
    // Nothing runs until the scheduler dispatches it.
    expect(log).toEqual([]);
    expect(exits.active).toBe(2);
    advance(16);
    expect(log).toEqual(["one:start", "two:start"]);
    // Time since the exit was due counts, including the frame that started it.
    advance(200);
    expect(log).toContain("one:dispose");
    expect(one.root.parent).toBeNull();
    expect(two.root.parent).toBe(two.parent);
    expect(exits.active).toBe(1);
    advance(400);
    expect(two.released).toHaveBeenCalledOnce();
    expect(exits.active).toBe(0);
    expect(scheduler.counts.active).toBe(0);
  });

  it("releases an exit cancelled before it starts, without running its effects", () => {
    log.length = 0;
    const { exits, advance } = shared();
    const v = visual();
    exits.start(snapshot, v, { steps: [{ effects: [timed("never", 1)] }] });
    exits.cancel(snapshot.blockId);
    advance(100);
    expect(log).toEqual([]);
    expect(v.root.parent).toBeNull();
    expect(v.released).toHaveBeenCalledOnce();
    expect(exits.active).toBe(0);
  });

  it("is cancelled cleanly when the scene's generation is disposed, releasing each visual once", () => {
    log.length = 0;
    const { scheduler, exits, advance } = shared();
    const [running, waiting] = [visual(), visual()];
    exits.start(snapshot, running, { steps: [{ effects: [timed("running", 1)] }] });
    advance(100);
    exits.start({ ...snapshot, blockId: "b2" }, waiting, { steps: [{ effects: [timed("w", 1)] }] });
    scheduler.disposeGeneration();
    advance(100);
    expect(log).toEqual(["running:start", "running:finish", "running:dispose"]);
    for (const v of [running, waiting]) {
      expect(v.root.parent).toBeNull();
      expect(v.released).toHaveBeenCalledOnce();
    }
    expect(exits.active).toBe(0);
  });

  it("lets the block simply go when the scheduler can't admit its exit", () => {
    log.length = 0;
    const { exits } = shared({ limits: { pendingGlobal: 1 } });
    const [first, v] = [visual(), visual()];
    exits.start(snapshot, first, { steps: [{ effects: [timed("first", 1)] }] });
    // The one pending place is taken, so this exit is refused.
    exits.start({ ...snapshot, blockId: "b2" }, v, { steps: [{ effects: [timed("refused", 1)] }] });
    expect(log).toEqual([]);
    expect(v.root.parent).toBeNull();
    expect(v.released).toHaveBeenCalledOnce();
    expect(first.root.parent).toBe(first.parent);
    expect(exits.active).toBe(1);
  });

  it("finishes an exit that outlasts the scheduler's time limit, and still releases it once", () => {
    log.length = 0;
    const { exits, advance } = shared({ limits: { maxEffectMs: 500 } });
    const v = visual();
    exits.start(snapshot, v, { steps: [{ effects: [timed("slow", 10)], maxSeconds: 10 }] });
    advance(16);
    advance(600);
    expect(log).toEqual(["slow:start", "slow:finish", "slow:dispose"]);
    expect(v.released).toHaveBeenCalledOnce();
    expect(exits.active).toBe(0);
  });

  it("still releases the visual, and fails its scope, when an exit can't start", () => {
    const { scheduler, exits, advance } = shared();
    const v = visual();
    exits.start(snapshot, v, { steps: [{ effects: [{ effect: "no-such-effect" }] }] });
    advance(16);
    expect(v.root.parent).toBeNull();
    expect(v.released).toHaveBeenCalledOnce();
    expect(exits.active).toBe(0);
    expect(scheduler.counts.active).toBe(0);
  });
});
