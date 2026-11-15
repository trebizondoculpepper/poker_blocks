import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import {
  createRefractionFront,
  createRefractionRear,
  refractionPresets,
} from "./crystal-refraction";
import { materialDeclaredAdapter, opticalShaderAdapter } from "./optical-mask";
import { createPairedMask, type PairedMaskUniforms } from "./paired-mask";

const uniforms = (): PairedMaskUniforms => ({
  matProgress: { value: 0.3 },
  matTime: { value: 0 },
  matFrequency: { value: 2 },
  matEdge: { value: 0.12 },
  matGlow: { value: new THREE.Color() },
  matReduced: { value: 0 },
  matFrame: { value: new THREE.Matrix4() },
  matOrigin: { value: new THREE.Vector3() },
});

describe("paired masks for optical looks (#1207)", () => {
  it("masks a custom optical shader, sharing its capture slots rather than copying them", () => {
    const front = createRefractionFront(refractionPresets.get("crystal"));
    const shared = uniforms();
    const made = opticalShaderAdapter.adapt(front, shared, "outgoing") as THREE.ShaderMaterial;
    expect(made).not.toBe(front);
    // The renderer-owned capture slots a prepass binds stay the very same objects.
    expect(made.uniforms.backgroundMap).toBe(front.uniforms.backgroundMap);
    expect(made.uniforms.offsetMap).toBe(front.uniforms.offsetMap);
    // One shared domain and progress with the other side.
    expect(made.uniforms.matProgress).toBe(shared.matProgress);
    expect(made.uniforms.matOutgoing!.value).toBe(1);
    expect(made.vertexShader).toContain("matWorld = (modelMatrix * vec4(position, 1.0)).xyz;");
    expect(made.fragmentShader).toMatch(/void main\(\) \{\s*\{\s*vec3 matRay/);
    expect(made.fragmentShader).toContain("discard");
    // The original is untouched.
    expect(front.fragmentShader).not.toContain("matRay");
  });

  it("dispatches by each material's own declaration, and refuses an undeclared one", () => {
    const front = createRefractionFront(refractionPresets.get("crystal"));
    front.userData.maskAdapter = "opticalShader";
    const masked = materialDeclaredAdapter.adapt(
      front,
      uniforms(),
      "incoming",
    ) as THREE.ShaderMaterial;
    expect(masked.uniforms.matOutgoing!.value).toBe(0);
    const surface = new THREE.MeshStandardMaterial();
    surface.userData.maskAdapter = "chunkSurface";
    expect(materialDeclaredAdapter.adapt(surface, uniforms(), "incoming")).toBeInstanceOf(
      THREE.MeshStandardMaterial,
    );
    expect(() =>
      materialDeclaredAdapter.adapt(new THREE.MeshBasicMaterial(), uniforms(), "incoming"),
    ).toThrow("declares no registered mask adapter");
  });

  it("pairs a refraction crystal with a chunk look, front and rear masked, and restores them", () => {
    const preset = refractionPresets.get("crystal");
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const front = createRefractionFront(preset, geometry);
    const rear = createRefractionRear(geometry, preset);
    front.userData.maskAdapter = "opticalShader";
    (rear.material as THREE.Material).userData.maskAdapter = "opticalShader";
    const crystal = new THREE.Mesh(geometry, front);
    crystal.add(rear);
    const paper = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.8, 0.8),
      new THREE.MeshStandardMaterial(),
    );
    const mount = new THREE.Group();
    mount.add(crystal, paper);
    const result = createPairedMask({
      mount,
      outgoing: { root: crystal, maskAdapter: "materialDeclared" },
      incoming: { root: paper, maskAdapter: "chunkSurface" },
    });
    expect(result.ok).toBe(true);
    // Both the front and the rear the offset prepass draws are masked clones now.
    expect(crystal.material).not.toBe(front);
    expect(rear.material).not.toBe(rear.material === front ? null : undefined);
    const maskedRear = rear.material as THREE.ShaderMaterial;
    expect(maskedRear.fragmentShader).toContain("matRay");
    if (result.ok) result.mask.cancel();
    expect(crystal.material).toBe(front);
  });
});
