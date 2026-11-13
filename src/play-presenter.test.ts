import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./audio/sfx", () => ({ playSfx: vi.fn() }));

/** Each dissolve the presenter starts, finished only when the test says so. */
const dissolves: { reduced: boolean; done: boolean; updates: number }[] = [];
vi.mock("./visual/materialise", () => ({
  createMaterialise: (_root: unknown, { reduced = false } = {}) => {
    const dissolve = { reduced, done: false, updates: 0 };
    dissolves.push(dissolve);
    return {
      update() {
        dissolve.updates++;
        return !dissolve.done;
      },
      get running() {
        return !dissolve.done;
      },
      finish() {
        dissolve.done = true;
      },
    };
  },
}));

const source = (id: string) => ({ block: { id }, cube: new THREE.Group() });

async function presenter(reduced = false) {
  const { createPlayPresenter } = await import("./play-presenter");
  const refill = vi.fn();
  const disposed: string[] = [];
  const session = {
    discard: () => ({}),
    state: { hand: [], round: { score: 0 } },
    lastDiscardActivations: [],
  };
  const noop = () => undefined;
  const play = createPlayPresenter({
    game: () => session as never,
    views: {
      dispose: (rendered: { block: { id: string } }) => disposed.push(rendered.block.id),
    } as never,
    hand: { settle: noop, remove: noop, sync: noop, updateDrawIns: noop } as never,
    field: {} as never,
    cameraView: {} as never,
    scene: new THREE.Group(),
    assembly: new THREE.Group(),
    reducedMotion: () => reduced,
    deselect: noop,
    changed: noop,
    moved: noop,
    rackChanged: noop,
    activated: noop,
    refill,
    save: noop,
    decided: noop,
  });
  return { play, refill, disposed };
}

describe("discard refill order (#775)", () => {
  it("draws replacements only once the discarded cards have finished dissolving", async () => {
    dissolves.length = 0;
    const { play, refill, disposed } = await presenter();
    expect(play.discard([source("a"), source("b")] as never)).toBe(true);
    // Long past a wall-clock second, but the dissolves still run: nothing is drawn yet.
    play.update(performance.now() + 5000, 0.016);
    expect(refill).not.toHaveBeenCalled();
    dissolves[0]!.done = true;
    play.update(performance.now() + 5000, 0.016);
    expect(refill).not.toHaveBeenCalled();
    dissolves[1]!.done = true;
    play.update(performance.now() + 5000, 0.016);
    expect(refill).toHaveBeenCalledTimes(1);
    expect(disposed).toEqual(["a", "b"]);
    expect(play.busy).toBe(false);
  });

  it("refills as soon as reduced motion's short fade ends, without waiting a second", async () => {
    dissolves.length = 0;
    const { play, refill } = await presenter(true);
    play.discard([source("a")] as never);
    expect(dissolves[0]!.reduced).toBe(true);
    dissolves[0]!.done = true;
    play.update(performance.now(), 0.016);
    expect(refill).toHaveBeenCalledTimes(1);
  });

  it("an earlier discard finishing never reveals a later one's replacements", async () => {
    dissolves.length = 0;
    const { play, refill } = await presenter();
    play.discard([source("a")] as never);
    play.discard([source("b")] as never);
    dissolves[0]!.done = true;
    play.update(performance.now(), 0.016);
    expect(refill).not.toHaveBeenCalled();
    dissolves[1]!.done = true;
    play.update(performance.now(), 0.016);
    expect(refill).toHaveBeenCalledTimes(1);
  });
});
