import { describe, expect, it } from "vite-plus/test";
import { addCell, centerOfGravity, type MassCenter } from "./center-of-gravity";

describe("equal-mass block center", () => {
  it("tracks the true centroid of an uneven structure", () => {
    let center: MassCenter = { count: 0, sum: { x: 0, y: 0, z: 0 } };
    for (const cell of [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 1, z: 0 },
    ]) {
      center = addCell(center, cell);
    }
    expect(center.count).toBe(4);
    expect(centerOfGravity(center)).toEqual({ x: 1.25, y: 0.25, z: 0 });
  });

  it("rejects an empty structure", () => {
    expect(() => centerOfGravity({ count: 0, sum: { x: 0, y: 0, z: 0 } })).toThrow();
  });
});
