/**
 * Paired block-local material masks (#1166; doc/presentation-contracts.md, "Committed transition
 * fact and independent responses"). Two appearances of one block (outgoing and incoming) under one
 * following mount dissolve into each other with complementary coverage: wherever the incoming look
 * is not yet drawn, the outgoing one still is, so nothing is ever missing between them.
 *
 * - **One domain.** Both sides sample the same Perlin field (`materialise.ts`'s noise and easing)
 *   in the mount's own local space, at one frequency taken from the larger of the two looks'
 *   bounds, with one seed, clock and progress. Different-sized looks share the pattern, and a
 *   turning or flying mount carries it along.
 * - **Declared adapters.** Each look's assembly declares the registered mask adapter its
 *   materials support (`BlockAppearance.maskAdapter`). The mask dispatches to it by reference and
 *   never inspects a material's class or kind. An undeclared or unregistered adapter returns an
 *   explicit diagnostic before anything is touched, rather than leaving a look opaque.
 * - **Ownership.** Adapters make owned clones; the source materials are restored on finish or
 *   cancel and the clones disposed exactly once. Shared materials are never mutated.
 *
 * It knows no gameplay, transition policy or source identity: a presenter decides when to run it.
 */
import * as THREE from "three";
import { Registry } from "../core/registry";
import { BLOBS, EDGE, NOISE, materialiseAt } from "./materialise";

/** The uniforms both sides share: one domain, frequency, clock and progress. */
export type PairedMaskUniforms = {
  matProgress: { value: number };
  matTime: { value: number };
  matFrequency: { value: number };
  matEdge: { value: number };
  matGlow: { value: THREE.Color };
  matReduced: { value: number };
  /** World → mount-local: the shared, following noise domain. */
  matFrame: { value: THREE.Matrix4 };
};

export type MaskRole = "outgoing" | "incoming";

/** A registered adapter: an owned clone of `material` that draws this side of the mask. */
export type MaskAdapter = {
  adapt(material: THREE.Material, uniforms: PairedMaskUniforms, role: MaskRole): THREE.Material;
};

export const maskAdapters = new Registry<MaskAdapter>("mask adapter");

/**
 * The adapter for three.js's chunk-based materials (standard, physical, basic, …), opaque or
 * transparent: the shader is patched at its `void main()` and dithering chunk, as `materialise`
 * does, but in the shared mount-local domain. An outgoing side draws only where the incoming one
 * is not yet; the burning edge belongs to the incoming side.
 */
export const chunkSurfaceAdapter: MaskAdapter = {
  adapt(original, uniforms, role) {
    const made = original.clone();
    // Share, not copy, what the original's own shader reads from it.
    made.userData = original.userData;
    const before = original.onBeforeCompile.bind(original);
    const key = original.customProgramCacheKey.bind(original);
    made.customProgramCacheKey = () => `${key()}|pairedMask:${role}`;
    if (uniforms.matReduced.value > 0.5) made.transparent = true;
    const outgoing = role === "outgoing" ? 1 : 0;
    made.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      Object.assign(shader.uniforms, uniforms, { matOutgoing: { value: outgoing } });
      shader.vertexShader = `varying vec3 matWorld;\n${shader.vertexShader}`.replace(
        "#include <fog_vertex>",
        `#include <fog_vertex>
        matWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
      shader.fragmentShader = `varying vec3 matWorld;
        uniform float matProgress;
        uniform float matTime;
        uniform float matFrequency;
        uniform float matEdge;
        uniform vec3 matGlow;
        uniform float matReduced;
        uniform float matOutgoing;
        uniform mat4 matFrame;
        ${NOISE}
        ${shader.fragmentShader}`
        .replace(
          "void main() {",
          `void main() {
          float matRim = 0.0;
          if (matReduced < 0.5) {
            // The mount's own space: the pattern rides with the block, the same for both looks.
            vec3 matLocal = (matFrame * vec4(matWorld, 1.0)).xyz;
            vec3 matAt = matLocal * matFrequency + vec3(0.0, matTime * 0.9, matTime * 0.4);
            float matNoise = clamp(matFbm(matAt) * 1.6 + 0.5, 0.0, 1.0);
            float matCut = mix(-matEdge, 1.0 + matEdge, matProgress);
            if (matOutgoing > 0.5) {
              if (matNoise <= matCut) discard;
            } else {
              if (matNoise > matCut) discard;
              matRim = 1.0 - smoothstep(0.0, matEdge, matCut - matNoise);
            }
          }`,
        )
        .replace(
          "#include <dithering_fragment>",
          `#include <dithering_fragment>
          gl_FragColor.rgb += mix(matGlow, vec3(1.0, 0.97, 0.9), matRim * matRim) * matRim * 4.0;
          if (matReduced > 0.5) gl_FragColor.a *= matOutgoing > 0.5 ? 1.0 - matProgress : matProgress;`,
        );
    };
    return made;
  },
};

maskAdapters.register("chunkSurface", chunkSurfaceAdapter);

/** One side of the pair: its root (under the mount) and the adapter its look declared. */
export type MaskSide = { root: THREE.Object3D; maskAdapter?: string };

export type PairedMask = {
  readonly uniforms: PairedMaskUniforms;
  /** Advance by `delta` seconds; false once finished (outgoing hidden, materials restored). */
  update(delta: number): boolean;
  readonly running: boolean;
  /** Complete at once: the incoming look whole, the outgoing hidden. */
  finish(): void;
  /** Stop without completing: both looks restored to their own materials, visibility untouched. */
  cancel(): void;
};

export type PairedMaskResult = { ok: true; mask: PairedMask } | { ok: false; diagnostic: string };

/** The larger of the two looks' bounding radii in the mount's local space. */
function sharedRadius(mount: THREE.Object3D, sides: readonly MaskSide[]): number {
  mount.updateWorldMatrix(true, true);
  const toLocal = mount.matrixWorld.clone().invert();
  let radius = 0;
  for (const { root } of sides) {
    const box = new THREE.Box3().setFromObject(root).applyMatrix4(toLocal);
    if (!box.isEmpty()) radius = Math.max(radius, box.getBoundingSphere(new THREE.Sphere()).radius);
  }
  return Math.max(1e-6, radius);
}

/**
 * Pair `outgoing` and `incoming` under `mount`. Validates both declared adapters first; on success
 * every mesh in each root draws through its adapter's clone until finished or cancelled.
 */
export function createPairedMask(options: {
  mount: THREE.Object3D;
  outgoing: MaskSide;
  incoming: MaskSide;
  seconds?: number;
  reduced?: boolean;
  glow?: string;
}): PairedMaskResult {
  const { mount, outgoing, incoming, seconds = 1.6, reduced = false, glow = "#ffb347" } = options;
  const sides: [MaskRole, MaskSide][] = [
    ["outgoing", outgoing],
    ["incoming", incoming],
  ];
  for (const [role, side] of sides) {
    if (!side.maskAdapter)
      return { ok: false, diagnostic: `${role} look declares no mask adapter` };
    if (!maskAdapters.has(side.maskAdapter))
      return {
        ok: false,
        diagnostic: `${role} look's mask adapter "${side.maskAdapter}" is not registered`,
      };
  }
  const uniforms: PairedMaskUniforms = {
    matProgress: { value: 0 },
    matTime: { value: 0 },
    matFrequency: { value: BLOBS / (2 * sharedRadius(mount, [outgoing, incoming])) },
    matEdge: { value: reduced ? 0 : EDGE },
    matGlow: { value: new THREE.Color(glow) },
    matReduced: { value: reduced ? 1 : 0 },
    matFrame: { value: new THREE.Matrix4() },
  };
  const swapped: {
    mesh: THREE.Mesh;
    material: THREE.Material | THREE.Material[];
    castShadow: boolean;
  }[] = [];
  const clones: THREE.Material[] = [];
  for (const [role, side] of sides) {
    const adapter = maskAdapters.get(side.maskAdapter!);
    const made = new Map<THREE.Material, THREE.Material>();
    const adapt = (material: THREE.Material) => {
      let clone = made.get(material);
      if (!clone) {
        clone = adapter.adapt(material, uniforms, role);
        made.set(material, clone);
        clones.push(clone);
      }
      return clone;
    };
    side.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.Material | THREE.Material[];
      swapped.push({ mesh: object, material, castShadow: object.castShadow });
      object.material = Array.isArray(material) ? material.map(adapt) : adapt(material);
      // A shadow would show a look whole before it is.
      object.castShadow = false;
    });
  }
  const followMount = () => {
    mount.updateWorldMatrix(true, false);
    uniforms.matFrame.value.copy(mount.matrixWorld).invert();
  };
  followMount();

  let running = true;
  let elapsed = 0;
  const duration = reduced ? Math.min(seconds, 0.4) : seconds;
  const restore = () => {
    if (!running) return false;
    running = false;
    for (const { mesh, material, castShadow } of swapped) {
      mesh.material = material;
      mesh.castShadow = castShadow;
    }
    for (const clone of clones) clone.dispose();
    clones.length = 0;
    return true;
  };
  const mask: PairedMask = {
    uniforms,
    get running() {
      return running;
    },
    update(delta) {
      if (!running) return false;
      elapsed += Math.max(0, delta);
      uniforms.matTime.value += Math.max(0, delta);
      uniforms.matProgress.value = materialiseAt(elapsed, duration);
      followMount();
      if (elapsed >= duration) mask.finish();
      return running;
    },
    finish() {
      if (restore()) {
        uniforms.matProgress.value = 1;
        outgoing.root.visible = false;
      }
    },
    cancel() {
      restore();
    },
  };
  return { ok: true, mask };
}
