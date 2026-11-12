import { describe, expect, it } from "vite-plus/test";
import {
  experimentalMaterials,
  getMaterialDefinition,
  materialDefinitions,
  type MaterialDefinition,
} from "../materials";
import { containerBreak, resolvedExit } from "./exit-defaults";

const all: readonly MaterialDefinition[] = [...materialDefinitions, ...experimentalMaterials];
const byId = (id: string) => all.find((definition) => definition.id === id)!;
const targets = (definition: MaterialDefinition) =>
  resolvedExit(definition.appearance)?.steps.flatMap(({ effects }) =>
    effects.map(({ effect, target }) => `${effect}:${target ?? "whole"}`),
  );

describe("a contained block's default exit (#638)", () => {
  it("is supplied by the contained composition to a new definition, with no dispatch edit", () => {
    const water = getMaterialDefinition("water");
    // A test-only contained look, registered nowhere and named in no code.
    const fresh: MaterialDefinition = {
      ...water,
      id: "testBrine",
      appearance: { ...water.appearance, exit: undefined, edge: { color: 0x123456, opacity: 0.6 } },
    };
    expect(resolvedExit(fresh.appearance)).toEqual(
      containerBreak({ colour: 0x123456, opacity: 0.6 }),
    );
  });

  it("cracks and breaks up the shell while the contents fade, each its own target", () => {
    expect(targets(getMaterialDefinition("water"))).toEqual([
      "crack:shell",
      "fracture:shell",
      "fade:contents",
    ]);
  });

  it("covers water, hot water and boiling water", () => {
    for (const id of ["water", "hotWaterInPlastic", "boilingWaterInPlastic"])
      expect(targets(byId(id)), id).toEqual(["crack:shell", "fracture:shell", "fade:contents"]);
  });

  it("never replaces an explicit recipe: Earth, Magic and the existing containers keep theirs", () => {
    for (const id of ["earth", "magic", "custard", "gelato"]) {
      const definition = byId(id);
      expect(definition.appearance.exit, id).toBeDefined();
      expect(resolvedExit(definition.appearance)).toBe(definition.appearance.exit);
    }
  });

  it("gives a look with no default and no recipe nothing", () => {
    const paper = getMaterialDefinition("paper");
    expect({ ...paper.appearance, exit: undefined }.assembly).not.toBe("contained");
    expect(resolvedExit({ ...paper.appearance, exit: undefined })).toBeUndefined();
  });
});
