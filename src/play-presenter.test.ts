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
  const { createVisualScheduler } = await import("./visual-events/scheduler");
  const { createPlayPresenter } = await import("./play-presenter");
  const refill = vi.fn();
  const disposed: string[] = [];
  /** Each discard draws its own replacements in the model, named after the call. */
  let draws = 0;
  const drawReplacements = vi.fn(() => [{ id: `new${++draws}` }]);
  const revealed: string[][] = [];
  const session = {
    discard: () => ({}),
    state: { hand: [], round: { score: 0 } },
    lastDiscardActivations: [],
  };
  const noop = () => undefined;
  const services = {
    get presentedActions() {
      return play.presentedActions;
    },
  };
  const scheduler = createVisualScheduler({ services });
  const play = createPlayPresenter({
    game: () => session as never,
    views: {
      dispose: (rendered: { block: { id: string } }) => disposed.push(rendered.block.id),
    } as never,
    hand: {
      settle: noop,
      remove: noop,
      sync: noop,
      updateDrawIns: noop,
      drawIn: (drawn: { id: string }[]) => revealed.push(drawn.map(({ id }) => id)),
    } as never,
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
    drawReplacements: drawReplacements as never,
    save: noop,
    decided: noop,
    visualEvents: scheduler,
  });
  // The shared scheduler runs the discards (#548); each frame advances it 16 ms.
  let real = 0;
  scheduler.update(real, true);
  const frame = () => scheduler.update((real += 16), true);
  return { play, refill, disposed, drawReplacements, revealed, frame, scheduler };
}

describe("discard refill order (#775)", () => {
  it("draws in the model at once, and reveals only after the discarded cards dissolve", async () => {
    dissolves.length = 0;
    const { play, refill, disposed, drawReplacements, revealed, frame } = await presenter();
    expect(play.discard([source("a"), source("b")] as never)).toBe(true);
    // Model first: the replacements are drawn as the discard commits.
    expect(drawReplacements).toHaveBeenCalledTimes(1);
    // Many frames, but the dissolves still run: nothing is shown yet.
    for (let i = 0; i < 100; i++) frame();
    dissolves[0]!.done = true;
    frame();
    expect(revealed).toEqual([]);
    dissolves[1]!.done = true;
    frame();
    expect(revealed).toEqual([["new1"]]);
    expect(disposed).toEqual(["a", "b"]);
    expect(refill).not.toHaveBeenCalled();
    expect(play.busy).toBe(false);
  });

  it("reveals as soon as reduced motion's short fade ends, without waiting a second", async () => {
    dissolves.length = 0;
    const { play, revealed, frame } = await presenter(true);
    play.discard([source("a")] as never);
    expect(dissolves[0]!.reduced).toBe(true);
    dissolves[0]!.done = true;
    frame();
    frame();
    expect(revealed).toEqual([["new1"]]);
  });

  it("each discard reveals only its own replacements, whichever finishes first", async () => {
    dissolves.length = 0;
    const { play, revealed, drawReplacements, frame } = await presenter();
    play.discard([source("a")] as never);
    play.discard([source("b")] as never);
    expect(drawReplacements).toHaveBeenCalledTimes(2);
    frame();
    dissolves[1]!.done = true;
    frame();
    expect(revealed).toEqual([["new2"]]);
    dissolves[0]!.done = true;
    frame();
    expect(revealed).toEqual([["new2"], ["new1"]]);
  });

  it("runs on the shared scheduler: a reset cancels it, and nothing shows afterwards (#548)", async () => {
    dissolves.length = 0;
    const { play, revealed, frame, scheduler } = await presenter();
    play.discard([source("a")] as never);
    frame();
    expect(play.busy).toBe(true);
    expect(scheduler.counts.active).toBe(1);
    play.reset();
    // Its dissolve is put back, and its replacements are never revealed by a late frame.
    expect(dissolves[0]!.done).toBe(true);
    for (let i = 0; i < 10; i++) frame();
    expect(revealed).toEqual([]);
    expect(play.busy).toBe(false);
    expect(scheduler.counts.active).toBe(0);
  });

  it("holds while the page is hidden: hidden time never advances it (#548)", async () => {
    dissolves.length = 0;
    const { play, frame, scheduler } = await presenter();
    play.discard([source("a")] as never);
    frame();
    frame();
    const updates = dissolves[0]!.updates;
    scheduler.update(100_000, false);
    expect(dissolves[0]!.updates).toBe(updates);
    expect(play.busy).toBe(true);
  });
});
