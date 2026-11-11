import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { createPassiveVisual } from "../passive-visual";
import { passiveAppearance, createPassiveBlock } from "../passives";

describe("Le Chef's toque (#378)", () => {
  it("is the hat alone, inside the bounds of a passive cube of the same size", () => {
    const visual = createPassiveVisual(passiveAppearance(createPassiveBlock("le-chef", "p1")), 1);
    visual.geometry.computeBoundingBox();
    const box = visual.geometry.boundingBox!;
    const cube = new THREE.Box3(
      new THREE.Vector3(-0.5, -0.5, -0.5),
      new THREE.Vector3(0.5, 0.5, 0.5),
    );
    expect(cube.containsBox(box)).toBe(true);
    expect(visual.materials).toHaveLength(1);
    expect(visual.textures).toEqual([]);
    visual.dispose();
  });
});
