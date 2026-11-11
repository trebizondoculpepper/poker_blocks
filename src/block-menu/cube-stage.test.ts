import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { useStageReflections } from "./cube-stage";

describe("menu stage reflections (#532 review)", () => {
  it("points reflective materials at the stage's own environment, leaving the rest alone", () => {
    const gameEnvironment = new THREE.Texture();
    const stageEnvironment = new THREE.Texture();
    const shiny = new THREE.MeshStandardMaterial({ envMap: gameEnvironment });
    const matte = new THREE.MeshStandardMaterial();
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), [shiny, matte]));
    useStageReflections(group, stageEnvironment);
    expect(shiny.envMap).toBe(stageEnvironment);
    expect(matte.envMap).toBeNull();
  });
});
