import { describe, expect, it } from "vite-plus/test";
import {
  experimentalMaterials,
  materialDefinitions,
  type MaterialDefinition,
} from "../../materials";
import { profilingCases, uncoveredCases } from "./cases";
import { resolvedExit } from "../../visual/exit-defaults";
import "./all-cases";

describe("letter, menu cube and exit profiling cases (#622)", () => {
  const all: readonly MaterialDefinition[] = [...materialDefinitions, ...experimentalMaterials];

  it("registers a letter block and a menu cube case for every material", () => {
    for (const { id } of all) {
      expect(profilingCases.get(`letter:${id}`).family).toBe("letter block");
      expect(profilingCases.get(`menu-cube:${id}`).family).toBe("menu cube");
    }
  });

  it("profiles every material's exit at rest and while it plays", () => {
    const exiting = all.filter(({ appearance }) => resolvedExit(appearance));
    // Contained looks get their composition's default exit, so water has a case too.
    expect(exiting.map(({ id }) => id)).toContain("water");
    expect(exiting.length).toBeGreaterThan(0);
    for (const { id } of exiting) {
      const exit = profilingCases.get(`exit:${id}`);
      // One instance is one complete exit, and its exit phase restarts as each one ends (#711).
      expect(exit.unit).toEqual({ kind: "emitter", size: 1 });
      expect(exit.phases).toEqual([
        { name: "idle", sampling: "steady" },
        { name: "exit", sampling: "restarting" },
      ]);
    }
  });

  it("leaves nothing uncovered", () => {
    expect(uncoveredCases()).toEqual([]);
  });
});
