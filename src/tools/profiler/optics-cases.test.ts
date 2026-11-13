import { describe, expect, it } from "vite-plus/test";
import { opticsBackends } from "../../visual/optics-backends";
import { profilingCases, uncoveredCases } from "./cases";
import { opticsCaseId } from "./optics-cases";
import { resolvePasses } from "./pipelines";

describe("optics profiling recipes (#764)", () => {
  it("has a case for every optics backend", () => {
    expect(uncoveredCases().filter(({ family }) => family === "optics")).toEqual([]);
  });

  it("declares a backend's capture passes, so a capture look is measured through them", () => {
    for (const backend of ["refraction", "internal", "calmWater"])
      expect(profilingCases.get(opticsCaseId(backend)).pipeline).toEqual([
        { handler: "opticsCapture", config: { backend } },
      ]);
    expect(profilingCases.get(opticsCaseId("crystalV3")).pipeline).toEqual([]);
  });

  it("resolves every recipe's pipeline", () => {
    for (const backend of opticsBackends.names())
      expect(() =>
        resolvePasses(profilingCases.get(opticsCaseId(backend)).pipeline ?? []),
      ).not.toThrow();
  });
});
