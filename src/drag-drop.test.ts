import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { Registry } from "./core/registry";
import { createDragDropManager, type DropVerdict, type DropTarget } from "./drag-drop";

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

describe("drag and drop (#273)", () => {
  it("hit-tests enabled drop targets by priority, and the first with an answer takes the point", () => {
    const log: string[] = [];
    const kinds = new Registry<DropTarget>("drop target");
    kinds.register("wide", target(0, 100, log, "wide"));
    kinds.register("bin", target(40, 60, log, "bin", true));
    const router = createDragDropManager(kinds);
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
    const router = createDragDropManager(kinds);
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
    const router = createDragDropManager(kinds);
    router.enable({ target: "a", priority: 1 });
    router.enable({ target: "b", priority: 1 });
    router.hover(router.hitTest([], 15, 0));
    expect(log).toEqual(["a:clear", "b:accept"]);
  });

  it("refuses an unknown drop target kind", () => {
    const router = createDragDropManager(new Registry<DropTarget>("drop target"));
    expect(() => router.enable({ target: "nowhere", priority: 1 })).toThrow();
  });

  it("guardrail: the manager names no drop target", () => {
    const source = readFileSync(new URL("./drag-drop.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/"discard"|"bin"|"grid"|"hand"|"rack"/);
  });
});
