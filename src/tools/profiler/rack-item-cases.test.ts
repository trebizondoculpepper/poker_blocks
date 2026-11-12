import { describe, expect, it } from "vite-plus/test";
import { passiveDefinitions } from "../../passives";
import { profilingCases, uncoveredCases } from "./cases";
import "./all-cases";

describe("rack item profiling cases (#621)", () => {
  it("registers a case for every passive definition and leaves none uncovered", () => {
    expect(passiveDefinitions.names().length).toBeGreaterThan(0);
    for (const id of passiveDefinitions.names())
      expect(profilingCases.has(`rack-item:${id}`)).toBe(true);
    expect(uncoveredCases()).toEqual([]);
  });
});
