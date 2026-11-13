import { describe, expect, it } from "vite-plus/test";
import {
  experimentalMaterials,
  materialDefinitions,
  materialPools,
  type MaterialDefinition,
} from "./materials";
import { ordinaryPassives, passiveDefinitions } from "./passives";
import { resolveReleaseStatus } from "./release-status";
import "./nothingifier";
import "./transmogrifiers";

const ids = (definitions: readonly { id: string }[]) => definitions.map(({ id }) => id);

describe("release-status declarations (#812)", () => {
  it("certifies every production material and keeps every prototype provisional", () => {
    for (const definition of materialDefinitions as readonly MaterialDefinition[])
      expect(resolveReleaseStatus(definition.id, definition.releaseStatus), definition.id).toBe(
        "certified",
      );
    for (const definition of experimentalMaterials)
      expect(resolveReleaseStatus(definition.id, definition.releaseStatus), definition.id).toBe(
        "provisional",
      );
  });

  it("leaves the gameplay pool exactly as it was, and the registered pool holding both", () => {
    expect(ids(materialPools.get("gameplay")())).toEqual(ids(materialDefinitions));
    const registered = ids(materialPools.get("registered")());
    expect(registered).toEqual(expect.arrayContaining(ids(experimentalMaterials)));
    expect(registered).toEqual(expect.arrayContaining(ids(materialDefinitions)));
  });

  it("declares every registered passive, all certified, and offers them as before", () => {
    const all = passiveDefinitions.names().map((name) => passiveDefinitions.get(name));
    for (const definition of all)
      expect(resolveReleaseStatus(definition.id, definition.releaseStatus), definition.id).toBe(
        "certified",
      );
    expect(ids(ordinaryPassives())).toEqual(ids(all));
  });

  it("never offers a provisional passive to normal play", () => {
    const template = passiveDefinitions.get(passiveDefinitions.names()[0]!);
    passiveDefinitions.register("test.trial-passive", {
      ...template,
      id: "test.trial-passive",
      releaseStatus: { provisional: {} },
    });
    expect(ids(ordinaryPassives())).not.toContain("test.trial-passive");
  });

  it("names a card's release status in its inspection, from the shared descriptor (#813)", async () => {
    const { inspectBlock } = await import("./traits/inspectable");
    const { standardDeck } = await import("./cards");
    const { getMaterialDefinition, withMaterial } = await import("./materials");
    const { releaseStatusDescriptor } = await import("./release-status");
    const wood = withMaterial(standardDeck[0]!, getMaterialDefinition("wood"));
    expect(inspectBlock(wood)!.split("\n")[1]).toBe("Status: Certified");
    const vent = withMaterial(standardDeck[0]!, getMaterialDefinition("airVent" as never));
    expect(inspectBlock(vent)).toContain("Status: Provisional");
    expect(releaseStatusDescriptor("wood", { certified: {} }).label).toBe("Certified");
    // A passive's own inspection carries its status too (#851 review).
    const { createPassiveBlock } = await import("./passives");
    const passive = createPassiveBlock(passiveDefinitions.names()[0]!, "p1");
    expect(passive.traits.inspectable.inspect()).toMatch(/\nStatus: Certified$/);
  });
});
