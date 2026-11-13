import { readFileSync } from "node:fs";
import { cardFaceArt } from "./face-art";
import { describe, expect, it, vi } from "vite-plus/test";
import { standardDeck } from "../cards";
import type { MaterialDefinition } from "../materials";
import { createBlockAppearance } from "./block-appearance";

describe("composed material appearance", () => {
  it("builds a new material from existing visual parts without a material-specific branch", () => {
    const context = { fillRect: vi.fn(), fillText: vi.fn() };
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    });
    const definition: MaterialDefinition = {
      id: "test-amber",
      mass: { effective: 1, rationale: "test definition" },
      releaseStatus: { provisional: {} },
      materialFamily: "test",
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
        cardFaceArt(standardDeck[0].traits.identity!),
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
