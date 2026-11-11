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
    {
      geometry,
      size: 1,
      environment: null,
      faceTexture: () => new THREE.Texture() as THREE.CanvasTexture,
      ownSurface: (texture) => new THREE.MeshStandardMaterial({ map: texture }),
    },
    appearance.container!,
    appearance.contents,
  );
};

describe("contained components (#330)", () => {
  it("custard is a plastic shell holding its fluid and wall trace, in the agreed layers", () => {
    const { faces, extras } = build("custard");
    expect(faces[0]).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(new Set(faces).size).toBe(1);
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

describe("the assembled contained block (#330 review)", () => {
  it("draws its front skin after the inner wall, contents and residue, and before the gloss", async () => {
    const { vi } = await import("vite-plus/test");
    const { createBlockAppearance } = await import("./block-appearance");
    const { cardFaceArt } = await import("./face-art");
    const { standardDeck } = await import("../cards");
    const context = new Proxy(
      {},
      { get: (target, key) => (key in target ? Reflect.get(target, key) : () => ({ width: 0 })) },
    );
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    });
    try {
      const custard = materialPools
        .get("registered")()
        .find(({ id }) => id === "custard")!;
      const appearance = createBlockAppearance(
        cardFaceArt(standardDeck[0]!.traits.identity),
        custard,
        1,
      );
      const front = appearance.faceLayer!;
      expect(front).toBe(containedLayers.shellFront);
      const orders = (appearance.extras ?? []).map(({ renderOrder }) => renderOrder);
      for (const layer of ["shellBack", "contentsOpaque", "residue"] as const)
        expect(orders).toContain(containedLayers[layer]);
      expect(orders.filter((order) => order < front)).toHaveLength(3);
      expect(Math.min(...orders.filter((order) => order > front))).toBe(containedLayers.gloss);
      (appearance.extras ?? []).forEach((mesh) => (mesh.material as THREE.Material).dispose());
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("glass container shells (#331)", () => {
  it("holds the same custard contents in plastic, lantern and frame by configuration only", () => {
    const contentsLayers = (id: string) =>
      build(id)
        .extras.map(({ renderOrder }) => renderOrder)
        .filter(
          (order) => order === containedLayers.contentsOpaque || order === containedLayers.residue,
        );
    for (const id of ["custard", "custardLantern", "custardFrame"])
      expect(contentsLayers(id)).toEqual([containedLayers.contentsOpaque, containedLayers.residue]);
    const config = (id: string) =>
      materialPools
        .get("registered")()
        .find((material) => material.id === id)!.appearance.contents;
    expect(config("custardLantern")).toEqual(config("custard"));
    expect(config("custardFrame")).toEqual(config("custard"));
  });

  it("the empty lantern is the retired glass's six tinted panes with nothing inside", () => {
    const { faces, extras } = build("emptyLantern");
    expect(new Set(faces).size).toBe(6);
    expect(extras).toEqual([]);
  });
});

describe("a shell's generated textures are the block's to dispose (#399 review)", () => {
  it("keeps the frame's height map with the block's textures", async () => {
    const { vi } = await import("vite-plus/test");
    const { createBlockAppearance } = await import("./block-appearance");
    const { cardFaceArt } = await import("./face-art");
    const { standardDeck } = await import("../cards");
    const context = new Proxy(
      {},
      { get: (target, key) => (key in target ? Reflect.get(target, key) : () => ({ width: 0 })) },
    );
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    });
    try {
      const frame = materialPools
        .get("registered")()
        .find(({ id }) => id === "custardFrame")!;
      const appearance = createBlockAppearance(
        cardFaceArt(standardDeck[0]!.traits.identity),
        frame,
        1,
      );
      const bumpMaps = new Set(
        appearance.materials.flatMap((material) => [material.bumpMap ?? []].flat()),
      );
      expect(bumpMaps.size).toBeGreaterThan(0);
      for (const map of bumpMaps) expect(appearance.textures).toContain(map);
      // The shell's own artwork (the frame's face texture) is the block's to dispose too.
      const maps = new Set(appearance.materials.flatMap((material) => [material.map ?? []].flat()));
      for (const map of maps) expect(appearance.textures).toContain(map);
      (appearance.extras ?? []).forEach((mesh) => (mesh.material as THREE.Material).dispose());
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
