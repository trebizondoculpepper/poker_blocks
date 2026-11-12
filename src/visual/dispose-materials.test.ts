import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { disposeMaterials } from "./dispose-materials";

describe("disposing a mesh's materials (#768)", () => {
  it("frees a single material, and every material of a per-face array", () => {
    const disposed: string[] = [];
    const material = (name: string) => {
      const made = new THREE.MeshBasicMaterial();
      made.addEventListener("dispose", () => disposed.push(name));
      return made;
    };
    disposeMaterials(new THREE.Mesh(new THREE.BoxGeometry(), material("single")));
    disposeMaterials(new THREE.Mesh(new THREE.BoxGeometry(), [material("a"), material("b")]));
    expect(disposed).toEqual(["single", "a", "b"]);
  });
});
