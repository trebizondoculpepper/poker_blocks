import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { Registry } from "./core/registry";
import { DragDropManager, Draggable } from "@dnd-kit/dom";
import type { RenderedBlock } from "./rendered-blocks";
import {
  createDragDropManager,
  type DragSource,
  type DropTarget,
  type DropVerdict,
} from "./drag-drop";

/** A drop target over the x-range [from, to): it accepts, or rejects when `rejecting`. */
function target(
  from: number,
  to: number,
  log: string[],
  name: string,
  rejecting = false,
): DropTarget {
  return {
    canDrop: (_carried, x) => (x >= from && x < to ? (rejecting ? "reject" : "accept") : null),
    hover: (verdict: DropVerdict | null) => void log.push(`${name}:${verdict ?? "clear"}`),
    drop: () => true,
    reject: () => void log.push(`${name}:rejected`),
    describe: (verdict) => `${name} ${verdict}`,
  };
}

/** A bare dnd-kit manager: no sensors or plugins, the droppables only. */
const dnd = () => new DragDropManager({ plugins: [], sensors: [] });

describe("drag and drop (#273, on dnd-kit #282)", () => {
  it("hit-tests enabled drop targets by priority, and the first with an answer takes the point", () => {
    const log: string[] = [];
    const kinds = new Registry<DropTarget>("drop target");
    kinds.register("wide", target(0, 100, log, "wide"));
    kinds.register("bin", target(40, 60, log, "bin", true));
    const router = createDragDropManager(kinds, dnd());
    router.enable({ target: "wide", priority: 1 });
    expect(router.hitTest([], 50, 0)?.name).toBe("wide");
    // The bin, asked first, claims its part even though it rejects.
    router.enable({ target: "bin", priority: 10 });
    expect(router.hitTest([], 50, 0)).toMatchObject({ name: "bin", verdict: "reject" });
    expect(router.hitTest([], 10, 0)?.name).toBe("wide");
    expect(router.hitTest([], 200, 0)).toBeNull();
  });

  it("only hit-tests targets a scene has enabled, and stops when it's disabled", () => {
    const kinds = new Registry<DropTarget>("drop target");
    kinds.register("bin", target(0, 10, [], "bin"));
    const router = createDragDropManager(kinds, dnd());
    expect(router.hitTest([], 5, 0)).toBeNull();
    const disable = router.enable({ target: "bin", priority: 1 });
    expect(router.hitTest([], 5, 0)?.name).toBe("bin");
    disable();
    expect(router.hitTest([], 5, 0)).toBeNull();
  });

  it("shows the hit's hover feedback on its target and clears every other", () => {
    const log: string[] = [];
    const kinds = new Registry<DropTarget>("drop target");
    kinds.register("a", target(0, 10, log, "a"));
    kinds.register("b", target(10, 20, log, "b"));
    const router = createDragDropManager(kinds, dnd());
    router.enable({ target: "a", priority: 1 });
    router.enable({ target: "b", priority: 1 });
    router.hover(router.hitTest([], 15, 0));
    expect(log).toEqual(["a:clear", "b:accept"]);
  });

  it("drag sources pick up only while a scene enables them, and gate dnd-kit's start", () => {
    const block = { block: { id: "b1" } } as unknown as RenderedBlock;
    const sourceKinds = new Registry<DragSource>("drag source");
    sourceKinds.register("hand", { pick: (x) => (x < 10 ? block : null) });
    const manager = dnd();
    const router = createDragDropManager(new Registry<DropTarget>("drop target"), manager, {
      kinds: sourceKinds,
    });
    expect(router.pickUp(5, 0)).toBeNull();
    const disable = router.enableSource({ source: "hand" });
    expect(router.pickUp(5, 0)).toBe(block);
    expect(router.pickUp(50, 0)).toBeNull();
    const draggable = new Draggable({ id: "other" }, manager);
    // Only a draggable the manager registered for an enabled source may start a drag.
    expect(router.canStart(draggable, 5, 0)).toBe(false);
    disable();
    expect(router.pickUp(5, 0)).toBeNull();
    expect(() => router.enableSource({ source: "nowhere" })).toThrow();
  });

  it("a press on a drag source records what it picked up and where; a miss clears it", async () => {
    const block = { block: { id: "b1" } } as unknown as RenderedBlock;
    const sourceKinds = new Registry<DragSource>("drag source");
    sourceKinds.register("hand", { pick: (x) => (x < 10 ? block : null) });
    const manager = dnd();
    const router = createDragDropManager(new Registry<DropTarget>("drop target"), manager, {
      kinds: sourceKinds,
    });
    router.enableSource({ source: "hand" });
    // dnd-kit registers a draggable asynchronously.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [draggable] = [...manager.registry.draggables];
    expect(draggable).toBeDefined();
    expect(router.canStart(draggable!, 5, 7)).toBe(true);
    expect(router.pressed(draggable!)).toEqual({ picked: block, clientX: 5, clientY: 7 });
    expect(router.canStart(draggable!, 50, 7)).toBe(false);
    expect(router.pressed(draggable!)).toBeNull();
    // A cancelled gesture forgets its pending press.
    router.canStart(draggable!, 5, 7);
    router.forgetPresses();
    expect(router.pressed(draggable!)).toBeNull();
  });

  it("refuses an unknown drop target kind", () => {
    const router = createDragDropManager(new Registry<DropTarget>("drop target"), dnd());
    expect(() => router.enable({ target: "nowhere", priority: 1 })).toThrow();
  });

  it("guardrail: the manager names no drop target", () => {
    const source = readFileSync(new URL("./drag-drop.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/"discard"|"bin"|"grid"|"hand"|"rack"/);
  });
});
