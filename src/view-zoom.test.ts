import { describe, expect, it } from "vite-plus/test";
import {
  boardBaseFov,
  fovForZoom,
  maxViewZoom,
  minViewZoom,
  pinchZoom,
  wheelZoom,
} from "./view-zoom";

describe("board view zoom", () => {
  it("uses the same wheel direction across pixel and line devices", () => {
    expect(wheelZoom(1, -100, 0)).toBeGreaterThan(1);
    expect(wheelZoom(1, 100, 0)).toBeLessThan(1);
    expect(wheelZoom(1, -3, 1)).toBeCloseTo(wheelZoom(1, -48, 0));
    expect(wheelZoom(1, -100000, 0)).toBeCloseTo(wheelZoom(1, -200, 0));
  });

  it("scales a pinch from its starting spacing and respects limits", () => {
    expect(pinchZoom(1.5, 100, 200)).toBe(3);
    expect(pinchZoom(1.5, 100, 50)).toBe(0.75);
    expect(pinchZoom(1, 0, 200)).toBe(1);
    expect(pinchZoom(3, 100, 300)).toBe(maxViewZoom);
    expect(pinchZoom(1, 100, 1)).toBe(minViewZoom);
  });

  it("changes perspective FOV without changing the baseline", () => {
    expect(fovForZoom(1)).toBeCloseTo(boardBaseFov);
    expect(fovForZoom(2)).toBeLessThan(boardBaseFov);
    expect(fovForZoom(0.75)).toBeGreaterThan(boardBaseFov);
  });
});
