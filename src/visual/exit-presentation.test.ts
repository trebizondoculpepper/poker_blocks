import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  createExitRunner,
  exitEffects,
  type ExitContext,
  type ExitVisual,
} from "./exit-presentation";

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
    const runner = createExitRunner();
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
    const runner = createExitRunner();
    const v = visual();
    runner.start(snapshot, v, { steps: [{ effects: [timed("slow", 99)], maxSeconds: 0.5 }] });
    runner.update(0.6);
    expect(log).toEqual(["slow:start", "slow:finish", "slow:dispose"]);
    expect(v.released).toHaveBeenCalledTimes(1);
  });

  it("gives each effect its target: the whole block, its shell or its contents", () => {
    contexts.length = 0;
    const runner = createExitRunner();
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
    const runner = createExitRunner(() => true);
    runner.start(snapshot, visual(), { steps: [{ effects: [timed("r", 0.1)] }] });
    expect(contexts[0]!.reducedMotion).toBe(true);
    runner.dispose();
  });

  it("cancels one exit at once, and disposing the runner cancels the rest, each cleaned up once", () => {
    log.length = 0;
    const runner = createExitRunner();
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
    const runner = createExitRunner();
    const v = visual();
    runner.start(snapshot, v, { steps: [] });
    expect(v.released).toHaveBeenCalledTimes(1);
    expect(runner.active).toBe(0);
  });

  it("stops updating a parallel effect once it finishes, while the longer one runs on (#477 review)", () => {
    log.length = 0;
    const runner = createExitRunner();
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
