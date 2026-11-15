import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { createPairedMask, maskAdapters, type MaskAdapter } from "./paired-mask";

/** A look under the mount: a box of `size` with its own standard material (opaque or not). */
function look(size: number, transparent = false) {
  const material = new THREE.MeshStandardMaterial({ transparent, opacity: transparent ? 0.5 : 1 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material);
  const root = new THREE.Group();
  root.add(mesh);
  return { root, mesh, material };
}

/** Compile a material's patched shader against a minimal chunk-style program. */
function compile(material: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: "void main() {\n#include <fog_vertex>\n}",
    fragmentShader: "void main() {\n#include <dithering_fragment>\n}",
  };
  material.onBeforeCompile(shader as never, {} as never);
  return shader;
}

function pair(mountSetup?: (mount: THREE.Group) => void) {
  const mount = new THREE.Group();
  mountSetup?.(mount);
  const old = look(1);
  const next = look(2, true);
  mount.add(old.root, next.root);
  const result = createPairedMask({
    mount,
    outgoing: { root: old.root, maskAdapter: "chunkSurface" },
    incoming: { root: next.root, maskAdapter: "chunkSurface" },
    seconds: 1,
  });
  if (!result.ok) throw new Error(result.diagnostic);
  return { mount, old, next, mask: result.mask };
}

describe("paired block-local material masks (#1166; doc/presentation-contracts.md)", () => {
  it("shares one domain, frequency, clock and progress between both looks", () => {
    const { old, next, mask } = pair();
    const outgoing = compile(old.mesh.material as THREE.Material);
    const incoming = compile(next.mesh.material as THREE.Material);
    for (const name of ["matProgress", "matTime", "matFrequency", "matFrame"] as const)
      expect(outgoing.uniforms[name]).toBe(incoming.uniforms[name]);
    // Complementary roles: the outgoing side draws where the incoming one is not yet.
    expect(outgoing.uniforms.matOutgoing.value).toBe(1);
    expect(incoming.uniforms.matOutgoing.value).toBe(0);
    // Decided per view ray at the mount's camera-facing plane, in the mount's space (#1240).
    expect(outgoing.fragmentShader).toContain("matFrame * vec4(matHit, 1.0)");
    expect(outgoing.uniforms.matOrigin).toBe(incoming.uniforms.matOrigin);
    // Progress moves both together, from start through mid-transition.
    mask.update(0.5);
    expect(outgoing.uniforms.matProgress.value).toBeCloseTo(0.5);
    expect(incoming.uniforms.matProgress).toBe(outgoing.uniforms.matProgress);
  });

  it("takes its frequency from the larger look, so differently sized looks share the pattern", () => {
    const { mask } = pair();
    // The incoming 2-unit box's bounding radius is √3; eight blobs across its diameter.
    expect(mask.uniforms.matFrequency.value).toBeCloseTo(8 / (2 * Math.sqrt(3)), 5);
  });

  it("follows a turning, flying mount: the domain is the mount's local space", () => {
    const { mount, mask } = pair();
    mount.position.set(3, 1, -2);
    mount.rotation.set(0.3, 1.1, 0);
    mask.update(0.1);
    const local = new THREE.Vector3(0.2, 0.3, 0.4);
    const world = local.clone().applyMatrix4(mount.matrixWorld);
    expect(world.applyMatrix4(mask.uniforms.matFrame.value).distanceTo(local)).toBeLessThan(1e-9);
  });

  it("reports an undeclared or unregistered adapter before touching anything", () => {
    const mount = new THREE.Group();
    const old = look(1);
    const next = look(1);
    mount.add(old.root, next.root);
    const undeclared = createPairedMask({
      mount,
      outgoing: { root: old.root, maskAdapter: "chunkSurface" },
      incoming: { root: next.root },
    });
    expect(undeclared).toEqual({ ok: false, diagnostic: "incoming look declares no mask adapter" });
    const unknown = createPairedMask({
      mount,
      outgoing: { root: old.root, maskAdapter: "test.missing" },
      incoming: { root: next.root, maskAdapter: "chunkSurface" },
    });
    expect(unknown.ok).toBe(false);
    expect(old.mesh.material).toBe(old.material);
    expect(next.mesh.material).toBe(next.material);
  });

  it("dispatches to whichever adapter each look declares", () => {
    const adapt = vi.fn((material: THREE.Material, _uniforms: unknown, _role: string) =>
      material.clone(),
    );
    const custom: MaskAdapter = { adapt };
    maskAdapters.register("test.custom", custom);
    const mount = new THREE.Group();
    const old = look(1);
    const next = look(1);
    mount.add(old.root, next.root);
    const result = createPairedMask({
      mount,
      outgoing: { root: old.root, maskAdapter: "test.custom" },
      incoming: { root: next.root, maskAdapter: "chunkSurface" },
    });
    expect(result.ok).toBe(true);
    expect(adapt).toHaveBeenCalledTimes(1);
    expect(adapt.mock.calls[0]![2]).toBe("outgoing");
  });

  it("finishes with the incoming look whole and the outgoing hidden, restoring and disposing once", () => {
    const { old, next, mask } = pair();
    const clones = [old.mesh.material, next.mesh.material] as THREE.Material[];
    const disposed = clones.map((clone) => vi.spyOn(clone, "dispose"));
    const shared = [vi.spyOn(old.material, "dispose"), vi.spyOn(next.material, "dispose")];
    expect(mask.update(0.6)).toBe(true);
    expect(mask.update(0.6)).toBe(false);
    mask.finish();
    expect(old.mesh.material).toBe(old.material);
    expect(next.mesh.material).toBe(next.material);
    expect(old.root.visible).toBe(false);
    expect(next.root.visible).toBe(true);
    for (const spy of disposed) expect(spy).toHaveBeenCalledTimes(1);
    for (const spy of shared) expect(spy).not.toHaveBeenCalled();
  });

  it("cancels back to both looks' own materials, leaving visibility to its owner", () => {
    const { old, next, mask } = pair();
    mask.update(0.3);
    mask.cancel();
    mask.cancel();
    expect(old.mesh.material).toBe(old.material);
    expect(next.mesh.material).toBe(next.material);
    expect(old.root.visible).toBe(true);
    expect(mask.running).toBe(false);
  });

  it("keeps a transparent look transparent, and the shared material untouched", () => {
    const { next } = pair();
    const clone = next.mesh.material as THREE.MeshStandardMaterial;
    expect(clone).not.toBe(next.material);
    expect(clone.transparent).toBe(true);
    // oxlint-disable-next-line typescript/unbound-method -- comparing hook identity only
    expect(next.material.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile);
  });

  it("tracks the mount's origin for the view-facing decision plane (#1240)", () => {
    const { mount, mask } = pair();
    mount.position.set(3, 1, -2);
    mask.update(0.1);
    expect(mask.uniforms.matOrigin.value.toArray()).toEqual([3, 1, -2]);
  });

  it("crossfades under reduced motion with the outgoing look opaque underneath (#1240)", () => {
    const mount = new THREE.Group();
    const old = look(1);
    const next = look(2);
    mount.add(old.root, next.root);
    const result = createPairedMask({
      mount,
      outgoing: { root: old.root, maskAdapter: "chunkSurface" },
      incoming: { root: next.root, maskAdapter: "chunkSurface" },
      reduced: true,
    });
    if (!result.ok) throw new Error(result.diagnostic);
    expect((old.mesh.material as THREE.Material).transparent).toBe(false);
    expect((next.mesh.material as THREE.Material).transparent).toBe(true);
    expect(next.mesh.renderOrder).toBe(1);
    const fragment = compile(next.mesh.material as THREE.Material).fragmentShader;
    expect(fragment).toContain("matReduced > 0.5 && matOutgoing < 0.5");
    result.mask.cancel();
    expect(next.mesh.renderOrder).toBe(0);
  });
});
