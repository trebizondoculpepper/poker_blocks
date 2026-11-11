import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { createDropGuide, dropGuideShapes } from "./drop-guide";

const meshes = (object: THREE.Object3D) => {
  const found: THREE.Mesh[] = [];
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) found.push(child as THREE.Mesh);
  });
  return found;
};

describe("laser drop guides (#498)", () => {
  it("draws a rectangle as its four sides and a cross as two diagonals", () => {
    expect(dropGuideShapes.get("rectangle")(4, 2)).toHaveLength(8);
    const cross = dropGuideShapes.get("cross")(4, 2);
    expect(cross).toHaveLength(4);
    expect(cross[0]!.toArray()).toEqual([-2, -1, 0]);
    expect(cross[1]!.toArray()).toEqual([2, 1, 0]);
  });

  it("is laser beams sized to the target's bounds, rebuilt only when the size changes", () => {
    const guide = createDropGuide({ shape: "rectangle", colour: 0x65f4dd });
    guide.setBounds(4, 2);
    const first = meshes(guide.object);
    expect(first.length).toBeGreaterThan(0);
    const freed = vi.spyOn(first[0]!.geometry, "dispose");
    guide.setBounds(4, 2);
    expect(meshes(guide.object)[0]).toBe(first[0]);
    guide.setBounds(5, 2);
    expect(freed).toHaveBeenCalled();
    guide.dispose();
  });

  it("can't intercept input: a raycast through it finds nothing", () => {
    const guide = createDropGuide({ shape: "cross", colour: 0xff2020 });
    guide.setBounds(2, 2);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
    guide.object.updateMatrixWorld(true);
    expect(ray.intersectObject(guide.object, true)).toEqual([]);
    guide.dispose();
  });

  it("shows nothing for an empty target, and frees its beams when disposed", () => {
    const guide = createDropGuide({ shape: "rectangle", colour: 0x65f4dd });
    guide.setBounds(0, 0);
    expect(meshes(guide.object)).toEqual([]);
    guide.setBounds(3, 1);
    const material = meshes(guide.object)[0]!.material as THREE.Material;
    const freed = vi.spyOn(material, "dispose");
    guide.dispose();
    expect(freed).toHaveBeenCalled();
    expect(meshes(guide.object)).toEqual([]);
  });

  it("holds its haze still under reduced motion", () => {
    const guide = createDropGuide({ shape: "rectangle", colour: 0x65f4dd });
    guide.setBounds(2, 2);
    const material = meshes(guide.object)[0]!.material as THREE.ShaderMaterial;
    guide.update(1);
    const offset = material.uniforms.offset!.value.clone();
    guide.update(5, true);
    expect(material.uniforms.offset!.value.toArray()).toEqual(offset.toArray());
    guide.dispose();
  });
});
