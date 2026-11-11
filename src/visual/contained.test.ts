import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { getMaterialDefinition, materialPools } from "../materials";
import { composeContained, containedLayers } from "./contained";
import { sharedSimulations } from "./shared-simulation";
import "./filled-vessel";

const geometry = new THREE.BoxGeometry(1, 1, 1);
const build = (id: string) => {
  const { appearance } = materialPools
    .get("registered")()
    .find((material) => material.id === id)!;
  return composeContained(
    { geometry, size: 1, environment: null },
    appearance.container!,
    appearance.contents,
  );
};

describe("contained components (#330)", () => {
  it("custard is a plastic shell holding its fluid and wall trace, in the agreed layers", () => {
    const { faces, extras } = build("custard");
    expect(faces).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(extras.map(({ renderOrder }) => renderOrder)).toEqual([
      containedLayers.shellBack,
      containedLayers.gloss,
      containedLayers.contentsOpaque,
      containedLayers.residue,
    ]);
    // Contents sit inside the shell's interior: the fluid and trace scale from its inset.
    const [inner, , fluid, trace] = extras;
    expect(fluid!.scale.x).toBeLessThan(inner!.scale.x);
    expect(trace!.scale.x).toBeLessThan(inner!.scale.x);
    extras.forEach((mesh) => (mesh.material as THREE.Material).dispose());
  });

  it("an empty vessel is the same shell with nothing inside: composed, not special-cased", () => {
    const { extras } = build("emptyVessel");
    expect(extras.map(({ renderOrder }) => renderOrder)).toEqual([
      containedLayers.shellBack,
      containedLayers.gloss,
    ]);
  });

  it("the contents release their shared simulation when their materials are disposed", () => {
    const before = sharedSimulations.size;
    const { extras } = build("custard");
    expect(sharedSimulations.size).toBe(before + 1);
    extras.forEach((mesh) => (mesh.material as THREE.Material).dispose());
    expect(sharedSimulations.size).toBe(before);
  });

  it("ordinary atomic materials stay atomic", () => {
    expect(getMaterialDefinition("wood").appearance.container).toBeUndefined();
    expect(getMaterialDefinition("steel").appearance.assembly).not.toBe("contained");
  });
});
