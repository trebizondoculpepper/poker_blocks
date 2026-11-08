import { describe, expect, it } from "vite-plus/test";
import { attachmentCell, cellKey, faceFromNormal, faces } from "./attachable";

describe("attachable trait", () => {
  const origin = { x: 0, y: 0, z: 0 };

  it("accepts all six exposed faces when configured for all faces", () => {
    const trait = { faces };
    const neighbors = faces.map((face) => attachmentCell(trait, origin, face, new Set()));
    expect(neighbors).toEqual([
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
    ]);
    expect(faceFromNormal({ x: 0, y: 0, z: 1 })).toBe("south");
  });

  it("rejects disabled and occupied faces", () => {
    const trait = { faces: ["north"] as const };
    expect(attachmentCell(trait, origin, "south", new Set())).toBeNull();
    expect(
      attachmentCell(trait, origin, "north", new Set([cellKey({ x: 0, y: 0, z: -1 })])),
    ).toBeNull();
    expect(attachmentCell(undefined, origin, "north", new Set())).toBeNull();
  });
});
