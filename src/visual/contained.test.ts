import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { getMaterialDefinition, materialPools } from "../materials";
import { composeContained, containedLayers } from "./contained";
import "./filled-vessel";
import "./glass-shells";
import "./fire-core";
import "./fading-film";

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
    appearance.residue,
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

  it("a fluid works with no residue, and residue attaches without changing the fluid (#332)", () => {
    const { appearance } = materialPools
      .get("registered")()
      .find(({ id }) => id === "custard")!;
    const context = {
      geometry,
      size: 1,
      environment: null,
      faceTexture: () => new THREE.Texture() as THREE.CanvasTexture,
      ownSurface: (texture: THREE.CanvasTexture) =>
        new THREE.MeshStandardMaterial({ map: texture }),
    };
    const bare = composeContained(context, appearance.container!, appearance.contents);
    expect(bare.extras.map(({ renderOrder }) => renderOrder)).not.toContain(
      containedLayers.residue,
    );
    const traced = composeContained(
      context,
      appearance.container!,
      appearance.contents,
      appearance.residue,
    );
    expect(traced.extras.map(({ renderOrder }) => renderOrder)).toContain(containedLayers.residue);
    // Residue that needs a liquid surface cannot sit in an empty container.
    expect(() =>
      composeContained(context, appearance.container!, undefined, appearance.residue),
    ).toThrow(/liquidSurface/);
    [...bare.extras, ...traced.extras].forEach((mesh) =>
      (mesh.material as THREE.Material).dispose(),
    );
  });

  it("two vessels keep their own surfaces: each levels by its own motion (#332)", async () => {
    const { containedContents, createInteriorBoundary } = await import("./contained");
    const { appearance } = materialPools
      .get("registered")()
      .find(({ id }) => id === "custard")!;
    const make = () =>
      containedContents.get("levellingFluid")(
        createInteriorBoundary(geometry, 1, 0.92),
        appearance.contents!.config,
      );
    const a = make();
    const b = make();
    expect(a.capabilities.liquidSurface!.normal).not.toBe(b.capabilities.liquidSurface!.normal);
    // Turn one vessel over and step a few frames: only its surface moves.
    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    const level = new THREE.Quaternion();
    for (let frame = 0; frame < 3; frame++) {
      const common = { seconds: frame * 0.5, delta: frame ? 0.5 : 0, first: frame === 0 };
      a.update!({ ...common, rotation: frame ? turned : level });
      b.update!({ ...common, rotation: level });
    }
    expect(a.capabilities.liquidSurface!.normal.y).toBeLessThan(0.99);
    expect(b.capabilities.liquidSurface!.normal.y).toBeCloseTo(1, 5);
    expect(a.capabilities.liquidSurface!.wet(new THREE.Vector3(0, -0.4, 0))).toBe(true);
    expect(a.capabilities.liquidSurface!.wet(new THREE.Vector3(0, 0.4, 0))).toBe(false);
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

describe("one frame per contained block (#401 review)", () => {
  it("starts the wall trace at the published surface, so a tilted vessel shows no false band", async () => {
    const { containedContents, containedResidues, createInteriorBoundary } =
      await import("./contained");
    const { appearance } = materialPools
      .get("registered")()
      .find(({ id }) => id === "custard")!;
    const boundary = createInteriorBoundary(geometry, 1, 0.92);
    const fluid = containedContents.get("levellingFluid")(boundary, appearance.contents!.config);
    const trace = containedResidues
      .get("wallTrace")
      .build(boundary, fluid.capabilities, appearance.residue!.config);
    const tilted = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1);
    const frame = { seconds: 0, delta: 0, first: true, rotation: tilted };
    fluid.update!(frame);
    trace.update!(frame);
    const uniforms = (trace.meshes[0]!.material as THREE.ShaderMaterial).uniforms;
    expect(uniforms.traceNormal!.value.angleTo(uniforms.surfaceNormal!.value)).toBeCloseTo(0, 6);
  });
});

describe("the shared tick runs before whichever part draws first (#401 review)", () => {
  it("updates the fluid when the fluid itself is the first contained mesh drawn", () => {
    const { appearance } = materialPools
      .get("registered")()
      .find(({ id }) => id === "custard")!;
    const { extras } = composeContained(
      {
        geometry,
        size: 1,
        environment: null,
        faceTexture: () => new THREE.Texture() as THREE.CanvasTexture,
        ownSurface: (texture) => new THREE.MeshStandardMaterial({ map: texture }),
      },
      appearance.container!,
      appearance.contents,
      appearance.residue,
    );
    const block = new THREE.Group();
    block.rotation.x = 1;
    block.add(...extras);
    block.updateMatrixWorld(true);
    const fluid = extras.find(({ renderOrder }) => renderOrder === containedLayers.contentsOpaque)!;
    const normal = (fluid.material as THREE.ShaderMaterial).uniforms.surfaceNormal!
      .value as THREE.Vector3;
    fluid.onBeforeRender(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    // Turned 1 rad about x: world up seen from the block is no longer local +y.
    expect(normal.y).toBeLessThan(0.99);
    extras.forEach((mesh) => (mesh.material as THREE.Material).dispose());
  });
});

describe("the flame as contents (#335)", () => {
  it("burns in the iron frame (fire) and in the lantern by configuration only", () => {
    for (const id of ["fire", "flameLantern"]) {
      const { extras } = build(id);
      // Drawn after the front shell (5) and gloss (6): the glow is never painted over.
      expect(Math.max(...extras.map(({ renderOrder }) => renderOrder))).toBeGreaterThan(
        containedLayers.gloss,
      );
      extras.forEach((mesh) => (mesh.material as THREE.Material).dispose());
    }
  });

  it("no container code names it (comments aside)", async () => {
    const { readFileSync } = await import("node:fs");
    const code = (file: string) =>
      readFileSync(new URL(file, import.meta.url), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
    for (const file of ["./contained.ts", "./glass-shells.ts", "./filled-vessel.ts"])
      expect(code(file)).not.toMatch(/flame|fire/i);
  });
});

describe("the published surface is block-local (#401 review)", () => {
  it("matches the drawn fluid surface for a fluid that is not half full", async () => {
    const { containedContents, createInteriorBoundary } = await import("./contained");
    const { appearance } = materialPools
      .get("registered")()
      .find(({ id }) => id === "custard")!;
    const boundary = createInteriorBoundary(geometry, 1, 0.92);
    const fluid = containedContents.get("levellingFluid")(boundary, appearance.contents!.config);
    const surface = fluid.capabilities.liquidSurface!;
    // The drawn surface: the shader's height in the volume mesh's units, scaled to the block.
    const shaderHeight = (fluid.meshes[0]!.material as THREE.ShaderMaterial).uniforms.height!.value;
    const drawn = shaderHeight * boundary.volumeScale;
    expect(surface.height).toBeCloseTo(drawn, 9);
    expect(surface.wet(new THREE.Vector3(0, drawn - 0.001, 0))).toBe(true);
    expect(surface.wet(new THREE.Vector3(0, drawn + 0.001, 0))).toBe(false);
  });
});

describe("fluid looks (#333)", () => {
  it("custard, refractive water and a dark fluid share one levelling fluid; only the look differs", async () => {
    const { containedContents, createInteriorBoundary } = await import("./contained");
    const contents = (id: string) =>
      materialPools
        .get("registered")()
        .find((material) => material.id === id)!.appearance.contents!;
    const fluids = ["custard", "waterInPlastic", "darkFluid"].map((id) => contents(id));
    expect(new Set(fluids.map(({ effect }) => effect))).toEqual(new Set(["levellingFluid"]));
    const built = fluids.map(({ config }) =>
      containedContents.get("levellingFluid")(createInteriorBoundary(geometry, 1, 0.92), config),
    );
    expect(built[1]!.meshes[0]!.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect((built[1]!.meshes[0]!.material as THREE.MeshPhysicalMaterial).transmission).toBe(1);
    // Double-sided, so the cut shows a top surface from above rather than a hole (#413 review).
    expect((built[1]!.meshes[0]!.material as THREE.MeshPhysicalMaterial).side).toBe(
      THREE.DoubleSide,
    );
    for (const fluid of built) expect(fluid.capabilities.liquidSurface).toBeDefined();
    // Water swaps between plastic and glass by configuration only: the same contents config.
    expect(contents("waterInLantern")).toEqual(contents("waterInPlastic"));
  });
});

describe("every registered material's fluid names a look (#413 review)", () => {
  it("builds every material's contents without error", async () => {
    const { containedContents, createInteriorBoundary } = await import("./contained");
    for (const material of materialPools.get("registered")())
      for (const { effect, config } of [material.appearance.contents ?? []].flat()) {
        const built = containedContents.get(effect)(
          createInteriorBoundary(geometry, 1, 0.9),
          config,
        );
        built.meshes.forEach((mesh) => (mesh.material as THREE.Material).dispose());
      }
  });
});
