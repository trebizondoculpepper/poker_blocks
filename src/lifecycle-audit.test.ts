import { describe, expect, it } from "vite-plus/test";
import { auditLifecycles } from "./lifecycle-audit";
import "./trial-modifiers";
import "./transmogrifiers";
import "./nothingifier";
import "./playable-payload";
import "./dev-rankless-active";

describe("lifecycle declarations on every installed definition (#917)", () => {
  const audit = auditLifecycles();

  it("resolves every material, passive, rack item and active definition", () => {
    expect(audit.ok ? [] : audit.problems).toEqual([]);
  });

  const resolved = audit.ok ? audit.resolved : {};
  const lifecycleOf = (key: string) => resolved[key];

  it("keeps the approved exceptions from the declaration matrix", () => {
    expect(lifecycleOf("material:meat")).toEqual({
      retention: "run",
      reset: {
        facet: "resettable",
        config: { recipe: [{ handler: "doneness" }], boundary: "stage" },
      },
    });
    expect(lifecycleOf("material:gelato")).toMatchObject({
      retention: "run",
      reset: { facet: "resettable", config: { boundary: "round" } },
    });
    expect(lifecycleOf("material:cloud")).toMatchObject({
      retention: "stage",
      reset: { facet: "nonResettable" },
    });
  });

  it("gives ordinary cards, items and wrappers run retention and no automatic reset", () => {
    for (const key of [
      "material:wood",
      "material:water",
      "material:airVent",
      "passive:nothingifier",
      "active:devOpaqueContainer",
      "active:playableCard",
    ])
      expect(lifecycleOf(key)).toMatchObject({
        retention: "run",
        reset: { facet: "nonResettable" },
      });
  });

  it("covers every registered definition", () => {
    const keys = Object.keys(resolved);
    expect(keys.some((key) => key.startsWith("material:"))).toBe(true);
    expect(keys.filter((key) => key.startsWith("passive:")).length).toBeGreaterThan(10);
    expect(keys.filter((key) => key.startsWith("active:")).length).toBeGreaterThanOrEqual(3);
  });
});
