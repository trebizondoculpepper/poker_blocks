import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { bufferSize, overlayCentre, overlayFrustum, toOverlayRect } from "./hud-overlay";

describe("HUD overlay coordinates (#921)", () => {
  it("converts a viewport rectangle into host-local CSS pixels", () => {
    expect(
      toOverlayRect({ left: 130, top: 80, width: 50, height: 20 }, { left: 100, top: 30 }),
    ).toEqual({ left: 30, top: 50, width: 50, height: 20 });
  });

  it("projects a placed rectangle onto the same CSS pixels of the canvas", () => {
    const [width, height] = [400, 300];
    const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -100, 100);
    Object.assign(camera, overlayFrustum(width, height));
    camera.updateProjectionMatrix();
    const rect = { left: 30, top: 50, width: 50, height: 20 };
    const { x, y } = overlayCentre(rect);
    const ndc = new THREE.Vector3(x, y, 0).project(camera);
    // Back to CSS pixels from the canvas's top-left.
    expect(((ndc.x + 1) / 2) * width).toBeCloseTo(55);
    expect(((1 - ndc.y) / 2) * height).toBeCloseTo(60);
  });

  it("applies the device pixel ratio once, to the buffer only, capped at 2", () => {
    expect(bufferSize(400, 300, 1.5)).toEqual({ ratio: 1.5, width: 600, height: 450 });
    expect(bufferSize(400, 300, 3)).toEqual({ ratio: 2, width: 800, height: 600 });
    expect(bufferSize(0, 0, 0)).toEqual({ ratio: 1, width: 1, height: 1 });
  });
});
