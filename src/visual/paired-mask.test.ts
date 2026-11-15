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
    expect(undeclared).toEqual({
      ok: false,
      diagnostic: "incoming look's Mesh declares no mask adapter",
    });
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
    // The outgoing look writes no depth, so a smaller incoming one shows through it (#1264).
    expect((old.mesh.material as THREE.Material).depthWrite).toBe(false);
    expect(old.material.depthWrite).toBe(true);
    expect((next.mesh.material as THREE.Material).transparent).toBe(true);
    expect(next.mesh.renderOrder).toBe(1);
    // The depthless outgoing look draws after the opaque scene (#1273).
    expect(old.mesh.renderOrder).toBe(1000);
    const fragment = compile(next.mesh.material as THREE.Material).fragmentShader;
    expect(fragment).toContain("matReduced > 0.5 && matOutgoing < 0.5");
    result.mask.cancel();
    expect(next.mesh.renderOrder).toBe(0);
    expect(old.mesh.renderOrder).toBe(0);
  });

  it("keeps a transparent outgoing layer below the incoming look (#1291)", () => {
    const mount = new THREE.Group();
    const old = look(1, true);
    const next = look(1);
    mount.add(old.root, next.root);
    const result = createPairedMask({
      mount,
      outgoing: { root: old.root, maskAdapter: "chunkSurface" },
      incoming: { root: next.root, maskAdapter: "chunkSurface" },
      reduced: true,
    });
    if (!result.ok) throw new Error(result.diagnostic);
    expect(old.mesh.renderOrder).toBeLessThan(next.mesh.renderOrder);
    result.mask.cancel();
  });

  describe("contained shells, contents and animated extras (#1208)", () => {
    /** A contained look: a chunk shell, a custom-shader fluid and animated points declaring theirs. */
    function containedLook() {
      const shell = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial());
      const time = { value: 0 };
      const fluid = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.8, 0.8),
        new THREE.ShaderMaterial({
          userData: { maskAdapter: "shaderSurface" },
          uniforms: { time },
          vertexShader: "void main() { gl_Position = vec4(position, 1.0); }",
          fragmentShader: "uniform float time; void main() { gl_FragColor = vec4(time); }",
        }),
      );
      const bubbles = new THREE.Points(
        new THREE.BufferGeometry(),
        new THREE.ShaderMaterial({
          userData: { maskAdapter: "shaderSurface" },
          transparent: true,
          vertexShader: "void main() { gl_Position = vec4(position, 1.0); }",
          fragmentShader: "void main() { gl_FragColor = vec4(1.0); }",
        }),
      );
      const root = new THREE.Group();
      root.add(shell, fluid, bubbles);
      const sources = [shell.material, fluid.material, bubbles.material];
      return { root, shell, fluid, bubbles, time, sources };
    }

    function containedPair() {
      const mount = new THREE.Group();
      const old = containedLook();
      const next = look(1);
      const unrelated = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
      mount.add(old.root, next.root, unrelated);
      const made = createPairedMask({
        mount,
        outgoing: { root: old.root, maskAdapter: "chunkSurface" },
        incoming: { root: next.root, maskAdapter: "chunkSurface" },
      });
      if (!made.ok) throw new Error(made.diagnostic);
      return { mask: made.mask, old, next, unrelated };
    }

    it("masks every drawn part through its own declared adapter, points included", () => {
      const { old } = containedPair();
      for (const part of [old.shell, old.fluid, old.bubbles])
        expect(old.sources).not.toContain(part.material);
      const fluid = compile(old.fluid.material as THREE.Material);
      expect(fluid.fragmentShader).toMatch(/discard/);
      expect(fluid.uniforms.matProgress).toBeDefined();
    });

    it("keeps a contained simulation live: the masked clone shares its uniform values", () => {
      const { old } = containedPair();
      const clone = old.fluid.material as THREE.ShaderMaterial;
      old.time.value = 3;
      expect(clone.uniforms.time!.value).toBe(3);
      // The source material gains no mask uniforms once compiled.
      compile(clone);
      expect((old.sources[1] as THREE.ShaderMaterial).uniforms.matProgress).toBeUndefined();
    });

    it("leaves unrelated objects alone and restores every part on cancel, repeatably", () => {
      const first = containedPair();
      const unrelatedMaterial = first.unrelated.material;
      first.mask.cancel();
      expect(first.unrelated.material).toBe(unrelatedMaterial);
      expect([first.old.shell, first.old.fluid, first.old.bubbles].map((p) => p.material)).toEqual(
        first.old.sources,
      );
      // A second transition over the same parts adapts them afresh.
      const second = createPairedMask({
        mount: first.old.root.parent!,
        outgoing: { root: first.old.root, maskAdapter: "chunkSurface" },
        incoming: { root: first.next.root, maskAdapter: "chunkSurface" },
      });
      expect(second.ok).toBe(true);
      if (second.ok) second.mask.cancel();
    });

    it("names an undeclared custom part instead of drawing it whole", () => {
      const mount = new THREE.Group();
      const old = look(1);
      const stray = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
      stray.name = "stray sparks";
      const next = look(1);
      next.root.add(stray);
      mount.add(old.root, next.root);
      const made = createPairedMask({
        mount,
        outgoing: { root: old.root, maskAdapter: "chunkSurface" },
        incoming: { root: next.root, maskAdapter: "test.unregistered" },
      });
      expect(made).toEqual({
        ok: false,
        diagnostic: 'incoming look\'s mask adapter "test.unregistered" is not registered',
      });
    });
  });
});
