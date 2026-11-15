import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import type { CardBlock } from "./cards";
import type { EventEnvelope } from "./lifecycle/action";
import {
  materialTransitionHandlers,
  type MaterialTransitionServices,
} from "./material-transitions";
import type { RenderedBlock } from "./rendered-blocks";
import { materialTransitions } from "./scene-traits/material-transitions";
import { createVisualScheduler } from "./visual-events/scheduler";

type Host = MaterialTransitionServices["materialTransitions"];

// A real card's traits carry functions (a scheduled payload may not), as this one does (#1167).
const card = (id: string, material: string) =>
  ({ id, material, traits: { inspectable: { describe: () => material } } }) as unknown as CardBlock;

/** A table block's view: a cube whose own chunk materials the mask adapts. */
function view(block: CardBlock): RenderedBlock {
  const material = new THREE.MeshStandardMaterial();
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  return { block, cube, maskAdapter: "chunkSurface" } as unknown as RenderedBlock;
}

function harness() {
  const board = new THREE.Group();
  const table = new Map<string, RenderedBlock>();
  const released: RenderedBlock[] = [];
  const made: RenderedBlock[] = [];
  const diagnosed: string[] = [];
  const host: Host = {
    block: (id) => table.get(id) ?? null,
    detachedView(block) {
      const ghost = view(block);
      made.push(ghost);
      return ghost;
    },
    release: (ghost) => released.push(ghost),
    reducedMotion: () => false,
    diagnose: (message) => diagnosed.push(message),
  };
  const scheduler = createVisualScheduler({ services: { materialTransitions: host } });
  let now = 0;
  scheduler.update(0, true);
  const step = (ms: number) => {
    for (let t = 0; t < ms; t += 10) scheduler.update((now += 10), true);
  };
  const place = (block: CardBlock) => {
    const rendered = view(block);
    rendered.cube.position.set(3, 0, 1);
    board.add(rendered.cube);
    table.set(block.id, rendered);
    return rendered;
  };
  const listeners: ((facts: readonly EventEnvelope[]) => void)[] = [];
  const run = {
    onCommitted(listener: (facts: readonly EventEnvelope[]) => void) {
      listeners.push(listener);
      return () => void listeners.splice(listeners.indexOf(listener), 1);
    },
  };
  let nextEvent = 0;
  const change = (blockId: string, before: CardBlock, extra: object = {}, eventId?: string) => {
    const fact = {
      eventId: eventId ?? `e${++nextEvent}`,
      type: "block.materialChanged",
      payload: { blockId, snapshots: { before, after: card(blockId, "after") }, ...extra },
    } as unknown as EventEnvelope;
    for (const listener of listeners.slice()) listener([fact]);
  };
  const trait = materialTransitions<{
    services: { run: typeof run; visualEvents: typeof scheduler };
  }>();
  const context = { services: { run, visualEvents: scheduler } };
  return { board, table, released, made, diagnosed, step, place, change, trait, context };
}

describe("material transitions (#1167)", () => {
  it("dissolves the captured old look into the table block's own, following it, then frees it", () => {
    const h = harness();
    const block = h.place(card("a", "water"));
    const own = block.cube.material;
    const config = { seconds: 0.5, reducedSeconds: 0.12 };
    h.trait.enter!(h.context as never, config);
    h.change("a", card("a", "ice"));
    h.step(20);
    // The ghost of the old card sits at the block's pose; the block draws through the mask.
    const ghost = h.made[0]!;
    expect(ghost.block).toMatchObject({ material: "ice" });
    const mount = ghost.cube.parent!;
    expect(mount.position.toArray()).toEqual([3, 0, 1]);
    expect(block.cube.material).not.toBe(own);
    block.cube.position.set(4, 0, 1);
    h.step(100);
    expect(mount.position.x).toBe(4);
    h.step(600);
    // Finished: its own materials back, the ghost freed and gone from the board.
    expect(block.cube.material).toBe(own);
    expect(h.released).toEqual([ghost]);
    expect(mount.parent).toBeNull();
    h.trait.exit!(h.context as never, config);
  });

  it("lets a newer change replace one still running, from that change's own old card", () => {
    const h = harness();
    const block = h.place(card("a", "water"));
    const own = block.cube.material;
    const config = {};
    h.trait.enter!(h.context as never, config);
    h.change("a", card("a", "ice"));
    h.step(100);
    h.change("a", card("a", "water"));
    h.step(20);
    expect(h.released).toEqual([h.made[0]]);
    expect(h.made[1]!.block).toMatchObject({ material: "water" });
    h.step(700);
    expect(h.released).toEqual([h.made[0], h.made[1]]);
    expect(block.cube.material).toBe(own);
  });

  it("shows each committed fact once, and nothing for a block not on the table", () => {
    const h = harness();
    h.place(card("a", "water"));
    const config = {};
    h.trait.enter!(h.context as never, config);
    h.change("a", card("a", "ice"), {}, "same");
    h.change("a", card("a", "ice"), {}, "same");
    h.change("hand-card", card("hand-card", "ice"));
    h.step(20);
    expect(h.made).toHaveLength(1);
  });

  it("ends at once when the block is removed or redrawn, and when the scene leaves", () => {
    const h = harness();
    const block = h.place(card("a", "water"));
    const config = {};
    h.trait.enter!(h.context as never, config);
    h.change("a", card("a", "ice"));
    h.step(50);
    h.table.delete("a");
    h.step(20);
    expect(h.released).toEqual([h.made[0]]);
    h.table.set("a", block);
    h.change("a", card("a", "ice"));
    h.step(50);
    h.trait.exit!(h.context as never, config);
    expect(h.released).toEqual([h.made[0], h.made[1]]);
  });

  it("chooses the action's own transition, then the scene's, then perlinDissolve", () => {
    const h = harness();
    h.place(card("a", "water"));
    const chosen: string[] = [];
    for (const name of ["testScene", "testAction"])
      if (!materialTransitionHandlers.has(name))
        materialTransitionHandlers.register(name, () => {
          chosen.push(name);
          return "done";
        });
    const config = { handler: "testScene" };
    h.trait.enter!(h.context as never, config);
    h.change("a", card("a", "ice"));
    h.change("a", card("a", "ice"), { materialTransition: { handler: "testAction" } });
    h.step(20);
    expect(chosen).toEqual(["testScene", "testAction"]);
  });

  it("reports a look the mask can't pair and simply shows the new one", () => {
    const h = harness();
    const block = h.place(card("a", "water"));
    (block as { maskAdapter?: string }).maskAdapter = undefined;
    h.trait.enter!(h.context as never, {});
    h.change("a", card("a", "ice"));
    h.step(20);
    expect(h.diagnosed[0]).toContain("not shown");
    expect(h.released).toHaveLength(1);
  });
});
