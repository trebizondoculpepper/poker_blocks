import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { getMaterialDefinition } from "../materials";
import { previewEffects } from "./object-browser";
import "../visual/dust";

const grains = (points: THREE.Object3D) => {
  const alpha = (points as THREE.Points).geometry.getAttribute("puffAlpha");
  return Array.from({ length: alpha.count }, (_, i) => alpha.getX(i)).filter((a) => a > 0).length;
};

describe("object browser preview effects (#1011)", () => {
  it("gives a dust audition's preview its dust, which a turn of the preview releases", () => {
    const effects = previewEffects(getMaterialDefinition("earthDustAudition" as never), 2.2);
    expect(effects).toHaveLength(1);
    const cube = new THREE.Object3D();
    const [dust] = effects;
    // Still: nothing.
    for (let frame = 0; frame < 30; frame++) dust!.update(1 / 60, cube, false);
    expect(grains(dust!.object)).toBe(0);
    // Dragged round quickly, as a preview turned by hand: grains come off.
    for (let frame = 0; frame < 30; frame++) {
      cube.rotateY(6 / 60);
      cube.updateMatrixWorld(true);
      dust!.update(1 / 60, cube, false);
    }
    expect(grains(dust!.object)).toBeGreaterThan(0);
    effects.forEach((effect) => effect.dispose());
  });

  it("builds nothing for a material with no ongoing effects", () => {
    expect(previewEffects(getMaterialDefinition("wood"), 2.2)).toEqual([]);
  });
});
