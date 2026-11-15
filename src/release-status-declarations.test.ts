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
    // The production Present wrapper is the one certified experimental definition (#1129).
    for (const definition of experimentalMaterials)
      expect(resolveReleaseStatus(definition.id, definition.releaseStatus), definition.id).toBe(
        definition.id === "giftWrap" ? "certified" : "provisional",
      );
  });

  it("leaves the gameplay pool exactly as it was, and the registered pool holding both", () => {
    expect(ids(materialPools.get("gameplay")())).toEqual(ids(materialDefinitions));
    const registered = ids(materialPools.get("registered")());
    // Except a material a plain card can't wear, such as the wrapper's (#1421).
    const wearable = experimentalMaterials.filter(({ requires = [] }) => requires.length === 0);
    expect(registered).toEqual(expect.arrayContaining(ids(wearable)));
    expect(registered).not.toContain("giftWrap");
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

  it("admits provisional passives to normal play, and only passives (#1393)", async () => {
    const template = passiveDefinitions.get(passiveDefinitions.names()[0]!);
    passiveDefinitions.register("test.trial-passive", {
      ...template,
      id: "test.trial-passive",
      releaseStatus: { provisional: {} },
    });
    expect(ids(ordinaryPassives())).toContain("test.trial-passive");
    // The shared certified-only catalogue (materials and every other family) is unchanged.
    const { composeCatalogue, ordinaryCatalogue } = await import("./release-status");
    const provisional = { id: "test.provisional", releaseStatus: { provisional: {} } };
    expect(
      composeCatalogue(
        [provisional],
        ({ id }) => id,
        ({ releaseStatus }) => releaseStatus,
        ordinaryCatalogue,
      ),
    ).toEqual([]);
  });

  it("shows provisional status in inspection and never a certification notice (#813, #923)", async () => {
    const { inspectBlock } = await import("./traits/inspectable");
    const { standardDeck } = await import("./cards");
    const { getMaterialDefinition, withMaterial } = await import("./materials");
    const { releaseStatusDescriptor, releaseStatusPresentation } = await import("./release-status");
    const wood = withMaterial(standardDeck[0]!, getMaterialDefinition("wood"));
    expect(inspectBlock(wood)).not.toMatch(/certif/i);
    const vent = withMaterial(standardDeck[0]!, getMaterialDefinition("airVent" as never));
    expect(inspectBlock(vent)!.split("\n")[1]).toMatch(/^Status: Provisional/);
    expect(releaseStatusPresentation("wood", { certified: {} })).toEqual({ lines: [] });
    expect(releaseStatusPresentation("x", { provisional: {} }).badge).toBe("Provisional");
    // The internal metadata is still there for diagnostics and export.
    expect(releaseStatusDescriptor("wood", { certified: {} }).label).toBe("Certified");
    // A passive's own inspection: its ordinary description, and no certification notice.
    const { createPassiveBlock, passiveDefinitions: definitions } = await import("./passives");
    const name = definitions.names()[0]!;
    const passive = createPassiveBlock(name, "p1");
    const definition = definitions.get(name);
    expect(passive.traits.inspectable.inspect()).toBe(
      `${definition.name} — ${definition.description}`,
    );
  });
});
