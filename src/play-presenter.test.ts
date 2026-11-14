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

async function presenter(
  reduced = false,
  limits = {},
  extra: {
    activations?: unknown[];
    alongside?: (activation: never) => unknown;
    order?: string[];
  } = {},
) {
  const { createVisualScheduler } = await import("./visual-events/scheduler");
  const { createPlayPresenter } = await import("./play-presenter");
  const disposed: string[] = [];
  /** Each discard draws its own replacements in the model, named after the call. */
  let draws = 0;
  const drawReplacements = vi.fn(() => [{ id: `new${++draws}` }]);
  const revealed: string[][] = [];
  const session = {
    discard: () => ({}),
    state: { hand: [], round: { score: 0 } },
    lastDiscardActivations: extra.activations ?? [],
  };
  const noop = () => undefined;
  const services = {
    get presentedActions() {
      return play.presentedActions;
    },
  };
  const scheduler = createVisualScheduler({ services, limits });
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
    rackChanged: () => void extra.order?.push("rackChanged"),
    activated: noop,
    alongside: extra.alongside as never,
    drawReplacements: drawReplacements as never,
    save: noop,
    decided: noop,
    visualEvents: scheduler,
  });
  // The shared scheduler runs the discards (#548); each frame advances it 16 ms.
  let real = 0;
  scheduler.update(real, true);
  const frame = () => scheduler.update((real += 16), true);
  return { play, disposed, drawReplacements, revealed, frame, scheduler };
}

describe("discard refill order (#775)", () => {
  it("draws in the model at once, and reveals only after the discarded cards dissolve", async () => {
    dissolves.length = 0;
    const { play, disposed, drawReplacements, revealed, frame } = await presenter();
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

  it("completes, rather than drops, an action whose effect runs too long (#1033 review)", async () => {
    dissolves.length = 0;
    const { play, revealed, frame } = await presenter(false, { maxEffectMs: 100 });
    play.discard([source("a")] as never);
    // Its dissolve never finishes by itself; the scheduler gives up on it after 100 ms.
    for (let i = 0; i < 20; i++) frame();
    expect(dissolves[0]!.done).toBe(true);
    expect(revealed).toEqual([["new1"]]);
    expect(play.busy).toBe(false);
  });
});

describe("a discard's activation labels (#920)", () => {
  it("captures each activation's label as the discard commits, before the rack redraws, and shows them at once", async () => {
    const { visualHandlers } = await import("./visual-events/scheduler");
    const shown: string[] = [];
    if (!visualHandlers.has("test.discard.label"))
      visualHandlers.register("test.discard.label", (payload) => {
        shown.push(String(payload));
        return "done";
      });
    const order: string[] = [];
    const activations = [
      { activationId: "x:0", sourceId: "die" },
      { activationId: "x:1", sourceId: "quiet" },
      { activationId: "x:2", sourceId: "die" },
    ];
    const { play, frame } = await presenter(
      false,
      {},
      {
        activations,
        order,
        alongside: (activation: { activationId: string; sourceId: string }) => {
          order.push(`label ${activation.activationId}`);
          // A host with nothing to say for one of them shows nothing for it.
          return activation.sourceId === "quiet"
            ? null
            : { handler: "test.discard.label", payload: activation.activationId };
        },
      },
    );
    play.discard([source("a")] as never);
    expect(order).toEqual(["label x:0", "label x:1", "label x:2", "rackChanged"]);
    frame();
    // Repeated activations of one item each keep their own label, in committed order.
    expect(shown).toEqual(["x:0", "x:2"]);
  });
});
