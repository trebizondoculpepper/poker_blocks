import { describe, expect, it } from "vite-plus/test";
import { clamp01, easeInOutCubic, lerp, tweenValue } from "./easing";

describe("easing helpers", () => {
  it("clamps and interpolates reusable numeric values", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });

  it("eases from normal to one-tenth speed in half a second", () => {
    expect(tweenValue(0.25, 0.025, 0, 0.5)).toBe(0.25);
    expect(tweenValue(0.25, 0.025, 0.25, 0.5)).toBeCloseTo(0.1375);
    expect(tweenValue(0.25, 0.025, 0.5, 0.5)).toBe(0.025);
    expect(easeInOutCubic(0.5)).toBe(0.5);
  });
});
