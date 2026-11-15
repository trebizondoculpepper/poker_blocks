import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { createGameTable, createRoomBackdrop, createShadowLamp } from "./card-room";

/** A 2D context that accepts any drawing call, so the procedural textures paint without a browser. */
const anyContext = (): CanvasRenderingContext2D =>
  new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) =>
      key in target
        ? target[key]
        : key === "createLinearGradient" || key === "createRadialGradient"
          ? () => ({ addColorStop() {} })
          : key === "getImageData" || key === "createImageData"
            ? () => ({ data: new Uint8ClampedArray(4) })
            : () => undefined,
    set: (target, key, value) => ((target[key] = value), true),
  }) as unknown as CanvasRenderingContext2D;

describe("room scenery as separately owned parts (#1372)", () => {
  beforeAll(() =>
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: anyContext }),
    }),
  );
  afterAll(() => vi.unstubAllGlobals());

  it("the backdrop owns its texture and restores the previous background when disposed", () => {
    const scene = new THREE.Scene();
    const before = new THREE.Color(0x123456);
    scene.background = before;
    const backdrop = createRoomBackdrop(scene);
    expect(scene.background).toBeInstanceOf(THREE.CanvasTexture);
    backdrop.dispose();
    backdrop.dispose();
    expect(scene.background).toBe(before);
  });

  it("the table sits under the field on its layer, in the scene, and follows the field", () => {
    const scene = new THREE.Scene();
    const table = createGameTable(scene, 5);
    expect(table.object.parent).toBe(scene);
    expect(table.object.layers.isEnabled(5)).toBe(true);
    table.frame(new THREE.Vector3(1, 2, 3), 2, 0);
    expect(table.object.position.toArray()).toEqual([1, 2 - 2 - 0.5, 3]);
    expect(table.object.scale.x).toBe(9);
    // Easing: a later, larger field is approached, not jumped to.
    table.frame(new THREE.Vector3(1, 2, 3), 5, 0.1);
    expect(table.object.scale.x).toBeGreaterThan(9);
    expect(table.object.scale.x).toBeLessThan(15);
    table.dispose();
    expect(table.object.parent).toBeNull();
  });

  it("the shadow lamp follows the field and sets shadow quality on its renderers", () => {
    const scene = new THREE.Scene();
    const renderer = { shadowMap: { type: 0, enabled: false } } as unknown as THREE.WebGLRenderer;
    const lamp = createShadowLamp(scene, [renderer]);
    expect(renderer.shadowMap.type).toBe(THREE.PCFSoftShadowMap);
    lamp.frame(new THREE.Vector3(0, 0, 0), 3);
    const light = scene.children.find(
      (child) => (child as THREE.DirectionalLight).isLight,
    ) as THREE.DirectionalLight;
    expect(light.shadow.camera.right).toBe(7);
    lamp.setShadowQuality("low");
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(light.castShadow).toBe(true);
    expect(light.shadow.mapSize.x).toBe(1024);
    lamp.setShadowQuality("off");
    expect(renderer.shadowMap.enabled).toBe(false);
    lamp.dispose();
    expect(light.parent).toBeNull();
  });
});
