import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { blockOutline } from "./block-outline";
import { createLaserOutline } from "./laser-outline";
import { maskAdapters } from "./paired-mask";
import { createPairedMask } from "./paired-mask";
import "./optical-mask";

const geometry = new THREE.BoxGeometry(1, 1, 1);

describe("paired masks for edges and custom shaders (#1209)", () => {
  it("masks a look's outline with it, and its live opacity keeps animating the masked edge", () => {
    const live = { value: 0.4 };
    const outline = blockOutline({
      geometry,
      edgeColor: 0xffffff,
      edgeOpacity: 1,
      liveEdgeOpacity: live,
    });
    const own = outline.material as THREE.LineBasicMaterial;
    const block = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    block.add(outline);
    const other = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    const mount = new THREE.Group();
    mount.add(block, other);
    const result = createPairedMask({
      mount,
      outgoing: { root: block, maskAdapter: "chunkSurface" },
      incoming: { root: other, maskAdapter: "chunkSurface" },
    });
    expect(result.ok).toBe(true);
    // The edge draws through its own masked clone, no longer the late opaque original.
    expect(outline.material).not.toBe(own);
    live.value = 0.7;
    outline.onBeforeRender(
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
    expect((outline.material as THREE.LineBasicMaterial).opacity).toBe(0.7);
    if (result.ok) result.mask.cancel();
    expect(outline.material).toBe(own);
    // The shared original is never disposed by the mask.
    expect(own.userData.maskAdapter).toBe("chunkSurface");
  });

  it("declares the laser outline's own shader adapter, which keeps its live uniforms shared", () => {
    const laser = createLaserOutline(geometry, 0x65f4dd, 1);
    const meshes: THREE.Mesh[] = [];
    laser.object.traverse((node) => (node as THREE.Mesh).isMesh && meshes.push(node as THREE.Mesh));
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      const material = mesh.material as THREE.ShaderMaterial;
      expect(material.userData.maskAdapter).toBe("customShader");
      const masked = maskAdapters.get("customShader").adapt(
        material,
        {
          matProgress: { value: 0.5 },
          matTime: { value: 0 },
          matFrequency: { value: 1 },
          matEdge: { value: 0.1 },
          matGlow: { value: new THREE.Color() },
          matReduced: { value: 0 },
          matFrame: { value: new THREE.Matrix4() },
          matOrigin: { value: new THREE.Vector3() },
        },
        "incoming",
      ) as THREE.ShaderMaterial;
      // Its animated noise offset and opacity are the original's own uniforms.
      expect(masked.uniforms.offset).toBe(material.uniforms.offset);
      expect(masked.fragmentShader).toContain("matRay");
    }
  });
});
