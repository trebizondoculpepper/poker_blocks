import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { bufferSize, overlayCentre, overlayFrustum, toOverlayRect } from "./hud-overlay";

describe("HUD overlay coordinates (#921)", () => {
  it("converts a viewport rectangle into the canvas's own CSS pixels", () => {
    const canvas = { left: 100, top: 30, width: 400, height: 300 };
    expect(toOverlayRect({ left: 130, top: 80, width: 50, height: 20 }, canvas)).toEqual({
      left: 30,
      top: 50,
      width: 50,
      height: 20,
    });
  });

  it("scales when the canvas is displayed at another size than its camera", () => {
    const canvas = { left: 0, top: 0, width: 200, height: 150 };
    expect(
      toOverlayRect({ left: 20, top: 30, width: 10, height: 10 }, canvas, {
        width: 400,
        height: 300,
      }),
    ).toEqual({ left: 40, top: 60, width: 20, height: 20 });
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
