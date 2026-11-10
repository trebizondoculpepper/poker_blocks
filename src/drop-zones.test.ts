import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { Registry } from "./core/registry";
import { createDropZoneRouter, type DropVerdict, type DropZone } from "./drop-zones";

/** A zone over the x-range [from, to): it accepts, or refuses when `refusing`. */
function zone(from: number, to: number, log: string[], name: string, refusing = false): DropZone {
  return {
    verdictAt: (_carried, x) => (x >= from && x < to ? (refusing ? "refuse" : "accept") : null),
    preview: (verdict: DropVerdict | null) => void log.push(`${name}:${verdict ?? "clear"}`),
    deliver: () => true,
    refuse: () => void log.push(`${name}:refused`),
    describe: (verdict) => `${name} ${verdict}`,
  };
}

describe("drop zones (#273)", () => {
  it("asks enabled zones by priority, and the first with an answer claims the point", () => {
    const log: string[] = [];
    const kinds = new Registry<DropZone>("drop zone");
    kinds.register("wide", zone(0, 100, log, "wide"));
    kinds.register("bin", zone(40, 60, log, "bin", true));
    const router = createDropZoneRouter(kinds);
    router.enable({ zone: "wide", priority: 1 });
    expect(router.claimAt([], 50, 0)?.name).toBe("wide");
    // The bin, asked first, claims its part even though it refuses.
    router.enable({ zone: "bin", priority: 10 });
    expect(router.claimAt([], 50, 0)).toMatchObject({ name: "bin", verdict: "refuse" });
    expect(router.claimAt([], 10, 0)?.name).toBe("wide");
    expect(router.claimAt([], 200, 0)).toBeNull();
  });

  it("only asks zones a scene has enabled, and stops when it's disabled", () => {
    const kinds = new Registry<DropZone>("drop zone");
    kinds.register("bin", zone(0, 10, [], "bin"));
    const router = createDropZoneRouter(kinds);
    expect(router.claimAt([], 5, 0)).toBeNull();
    const disable = router.enable({ zone: "bin", priority: 1 });
    expect(router.claimAt([], 5, 0)?.name).toBe("bin");
    disable();
    expect(router.claimAt([], 5, 0)).toBeNull();
  });

  it("shows the claim's preview on its zone and clears every other", () => {
    const log: string[] = [];
    const kinds = new Registry<DropZone>("drop zone");
    kinds.register("a", zone(0, 10, log, "a"));
    kinds.register("b", zone(10, 20, log, "b"));
    const router = createDropZoneRouter(kinds);
    router.enable({ zone: "a", priority: 1 });
    router.enable({ zone: "b", priority: 1 });
    router.preview(router.claimAt([], 15, 0));
    expect(log).toEqual(["a:clear", "b:accept"]);
  });

  it("refuses an unknown zone kind", () => {
    const router = createDropZoneRouter(new Registry<DropZone>("drop zone"));
    expect(() => router.enable({ zone: "nowhere", priority: 1 })).toThrow();
  });

  it("guardrail: the router names no zone", () => {
    const source = readFileSync(new URL("./drop-zones.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/"discard"|"bin"|"grid"|"hand"|"rack"/);
  });
});
