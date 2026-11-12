import { describe, expect, it } from "vite-plus/test";
import { experimentalMaterials, materialDefinitions } from "../../materials";
import { profilingCases, uncoveredCases } from "./cases";
import "./all-cases";

describe("material profiling cases (#620)", () => {
  it("registers a case for every material, experimental ones included", () => {
    for (const definition of [...materialDefinitions, ...experimentalMaterials])
      expect(profilingCases.has(`material:${definition.id}`)).toBe(true);
  });

  it("leaves no material uncovered", () => {
    expect(uncoveredCases().filter(({ family }) => family === "material")).toEqual([]);
  });
});
