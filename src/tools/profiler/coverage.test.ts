import { describe, expect, it } from "vite-plus/test";
import { Registry } from "../../core/registry";
import { gameModeRegistry } from "../../game-modes";
import { catalogCoverage, describeCoverage, profilingCoverage, type ProfilingCase } from "./cases";
import "./all-cases";

/** A temporary registry set, so a new family can be added without touching the runner. */
function registries() {
  const cases = new Registry<ProfilingCase>("test case");
  const coverage = new Registry<() => readonly string[]>("test coverage");
  const unsupported = new Registry<{ family: string; reason: string }>("test unsupported");
  const make = (family: string): ProfilingCase => ({
    family,
    label: family,
    create: () => ({ object: null as never, dispose() {} }),
  });
  return { cases, coverage, unsupported, make };
}

describe("coverage against the composed expected catalogs (#710)", () => {
  it("discovers a newly registered family's cases with no runner change", () => {
    const { cases, coverage, unsupported, make } = registries();
    coverage.register("sparkles", () => ["sparkle:a", "sparkle:b"]);
    cases.register("sparkle:a", make("sparkles"));
    cases.register("sparkle:b", make("sparkles"));
    const report = catalogCoverage(["sparkles"], cases, coverage, unsupported);
    expect(report.complete).toBe(true);
    expect(report.totals).toEqual({ expected: 2, available: 2, unsupported: 0, uncovered: 0 });
  });

  it("tells an absent provider apart from a missing case", () => {
    const { cases, coverage, unsupported, make } = registries();
    coverage.register("sparkles", () => ["sparkle:a", "sparkle:b"]);
    cases.register("sparkle:a", make("sparkles"));
    const report = catalogCoverage(["sparkles", "smoke"], cases, coverage, unsupported);
    expect(report.complete).toBe(false);
    expect(report.catalogs).toEqual([
      expect.objectContaining({ catalog: "sparkles", installed: true, uncovered: ["sparkle:b"] }),
      expect.objectContaining({ catalog: "smoke", installed: false, expected: 0 }),
    ]);
    expect(describeCoverage(report)).toContain("smoke: no provider installed");
    expect(describeCoverage(report)).toContain("sparkles: no case for sparkle:b");
  });

  it("reports an unsupported entry with its reason, and never counts it as available", () => {
    const { cases, coverage, unsupported, make } = registries();
    coverage.register("sparkles", () => ["sparkle:a", "sparkle:v3"]);
    cases.register("sparkle:a", make("sparkles"));
    unsupported.register("sparkle:v3", { family: "sparkles", reason: "not built yet" });
    const report = catalogCoverage(["sparkles"], cases, coverage, unsupported);
    expect(report.totals).toEqual({ expected: 2, available: 1, unsupported: 1, uncovered: 0 });
    expect(report.catalogs[0]!.unsupported).toEqual([
      { id: "sparkle:v3", reason: "not built yet" },
    ]);
    expect(report.complete).toBe(true);
  });

  it("never calls an empty composition complete", () => {
    const { cases, coverage, unsupported } = registries();
    expect(catalogCoverage([], cases, coverage, unsupported).complete).toBe(false);
  });

  it("composes every installed family into the profiler mode, and it is complete", () => {
    const configs = gameModeRegistry
      .names()
      .flatMap((id) => gameModeRegistry.get(id).scenes)
      .flatMap((scene) => [scene.traits.devProfiler ?? []].flat());
    expect(configs.length).toBeGreaterThan(0);
    for (const { catalogs } of configs) {
      expect([...catalogs].sort()).toEqual([...profilingCoverage.names()].sort());
      expect(catalogCoverage(catalogs).complete).toBe(true);
    }
  });
});
