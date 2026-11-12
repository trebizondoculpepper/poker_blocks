import { readFileSync } from "node:fs";
import * as THREE from "three";
import { cardFaceArt } from "./face-art";
import { describe, expect, it, vi } from "vite-plus/test";
import { standardDeck } from "../cards";
import type { MaterialDefinition } from "../materials";
import { createBlockAppearance, disposeMaterialTextures } from "./block-appearance";

describe("composed material appearance", () => {
  it("builds a new material from existing visual parts without a material-specific branch", () => {
    const context = { fillRect: vi.fn(), fillText: vi.fn() };
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    });
    const definition: MaterialDefinition = {
      id: "test-amber",
      name: "Test Amber",
      traits: {},
      acoustics: { character: "test", hardness: 1, attach: "material.attach.paper" },
      appearance: {
        pattern: "goldFoil",
        assembly: "sixFaces",
        surface: "matte",
        height: "none",
        ink: { red: "#b00000", black: "#101010", onDark: false },
        edge: { color: 0x123456, opacity: 0.4 },
        geometry: { shape: "box", segments: 0, radius: 0, scale: 1 },
        reliefScale: 0,
        endGrainFaces: [],
      },
    };
    try {
      const appearance = createBlockAppearance(
        cardFaceArt(standardDeck[0].traits.identity),
        definition,
        2.4,
      );
      expect(appearance.materials).toHaveLength(6);
      expect(appearance.textures).toHaveLength(1);
      expect(appearance.edgeColor).toBe(0x123456);
      expect(appearance.edgeOpacity).toBe(0.4);
      expect(context.fillText).toHaveBeenCalledTimes(2);
      appearance.geometry.dispose();
      appearance.textures.forEach((texture) => texture.dispose());
      appearance.materials[0].dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("guardrail (#292): the renderer knows face art only through FaceArt, never a card's fields", () => {
    const source = readFileSync(new URL("./block-appearance.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bIdentityTrait\b|\.rank\b|\.suit\b|from "\.\.\/cards"/);
  });
});

describe("freeing a block's material textures (#662)", () => {
  const materialWith = (map: THREE.Texture) => ({ map }) as unknown as THREE.MeshStandardMaterial;

  it("frees a map the block owns", () => {
    const own = new THREE.Texture();
    let freed = 0;
    own.addEventListener("dispose", () => void freed++);
    disposeMaterialTextures([materialWith(own)]);
    expect(freed).toBe(1);
  });

  it("leaves a map shared with other blocks, so they are not forced to re-upload", () => {
    // Contained stars and smoke puffs build one texture and hand it to every block that uses
    // the effect; freeing it from one block's disposal would break all the others.
    const shared = new THREE.Texture();
    shared.userData.shared = true;
    let freed = 0;
    shared.addEventListener("dispose", () => void freed++);
    disposeMaterialTextures([materialWith(shared)]);
    expect(freed).toBe(0);
  });

  it("ignores a material with no map at all", () => {
    expect(() =>
      disposeMaterialTextures([materialWith(undefined as unknown as THREE.Texture)]),
    ).not.toThrow();
  });
});
