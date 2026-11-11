import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { experimentalMaterials } from "../materials";
import type { FaceArt } from "./face-art";
import { giftBox } from "./gift-box";

/** A 2D context that accepts any drawing call, so the box can paint without a browser. */
const anyContext = (): CanvasRenderingContext2D =>
  new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) =>
      key in target
        ? target[key]
        : key === "createLinearGradient"
          ? () => ({ addColorStop() {} })
          : () => undefined,
    set: (target, key, value) => ((target[key] = value), true),
  }) as unknown as CanvasRenderingContext2D;

describe("gift box (#496)", () => {
  it("prints the block's face art over the wrap, so a letter block shows its letter (#558)", () => {
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: anyContext }),
    });
    const painted: string[] = [];
    const art: FaceArt = { seed: "A", paint: (_g, pen) => painted.push(pen("black")) };
    const definition = experimentalMaterials.find(({ id }) => id === "giftWrap")!;
    try {
      const box = giftBox({ art, definition, geometry: new THREE.BoxGeometry(1, 1, 1), size: 1 });
      // Sides, top and underside each carry the print, in the material's own ink.
      expect(painted).toEqual(Array(3).fill(definition.appearance.ink.black));
      expect(new Set(box.materials).size).toBe(3);
      box.textures.forEach((texture) => texture.dispose());
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
