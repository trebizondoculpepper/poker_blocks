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
  /** The mount's origin in world space: the view-facing plane both looks are decided on. */
  matOrigin: { value: THREE.Vector3 };
};

export type MaskRole = "outgoing" | "incoming";

/** A registered adapter: an owned clone of `material` that draws this side of the mask. */
export type MaskAdapter = {
  adapt(material: THREE.Material, uniforms: PairedMaskUniforms, role: MaskRole): THREE.Material;
  /** Why it can't adapt `material`, checked for every material before anything is swapped. */
  refuse?(material: THREE.Material): string | null;
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
    // Reduced motion crossfades: only the incoming look fades, over an opaque outgoing one, so the
    // pair never lets the background through (#1240).
    if (uniforms.matReduced.value > 0.5 && role === "incoming") made.transparent = true;
    // ...and the opaque outgoing look writes no depth meanwhile, so an incoming look smaller than
    // it (inside it) still fades in over it rather than failing the depth test (#1264).
    if (uniforms.matReduced.value > 0.5 && role === "outgoing") made.depthWrite = false;
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
        uniform vec3 matOrigin;
        ${NOISE}
        ${shader.fragmentShader}`
        .replace(
          "void main() {",
          `void main() {
          float matRim = 0.0;
          if (matReduced < 0.5) {
            // Decided per view ray, not per surface point (#1240): this fragment's ray from the
            // camera meets the plane through the mount's origin facing the camera at one point,
            // the same for both looks at this pixel whatever their size, so exactly one draws.
            // That point, in the mount's own space, rides with the block.
            vec3 matRay = normalize(matWorld - cameraPosition);
            vec3 matFacing = normalize(cameraPosition - matOrigin);
            float matAlong = dot(matOrigin - cameraPosition, matFacing) / min(dot(matRay, matFacing), -1e-4);
            vec3 matHit = cameraPosition + matRay * matAlong;
            vec3 matLocal = (matFrame * vec4(matHit, 1.0)).xyz;
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
          if (matReduced > 0.5 && matOutgoing < 0.5) gl_FragColor.a *= matProgress;`,
        );
    };
    return made;
  },
};

maskAdapters.register("chunkSurface", chunkSurfaceAdapter);

/** How much later than the opaque scene the depthless outgoing look draws (#1273). */
export const outgoingDrawLate = 1000;

/** One side of the pair: its root (under the mount) and the adapter its look declared. */
export type MaskSide = { root: THREE.Object3D; maskAdapter?: string };

/**
 * A part the mask covers: a mesh or points (animated extras, #1208). Three's own flags, not
 * instanceof, so a part from another copy of the library still counts. Lines are outlines.
 */
const drawnPart = (node: THREE.Object3D) =>
  Boolean(
    (node as THREE.Mesh).isMesh ||
    (node as THREE.Points).isPoints ||
    // A look's edges (an outline's line segments) follow its coverage too (#1209).
    (node as THREE.Line).isLine,
  );

/**
 * A part's adapter: its material's declaration, else the nearest on it or its ancestors within
 * the look, else the look's.
 */
function adapterOf(node: THREE.Object3D, side: MaskSide): string | undefined {
  // A builder may declare it on the material it made (its own shader knows what it supports).
  const material = [(node as THREE.Mesh).material].flat()[0] as THREE.Material | undefined;
  const own = material?.userData.maskAdapter as string | undefined;
  if (own) return own;
  for (let at: THREE.Object3D | null = node; at; at = at.parent) {
    const declared = at.userData.maskAdapter as string | undefined;
    if (declared) return declared;
    if (at === side.root) break;
  }
  return side.maskAdapter;
}

/**
 * For parts with their own shader (fluids, bubbles, stars, fire, film; #1208): any material with a
 * `void main()`. Its fragments are kept or discarded by the same shared per-ray noise as the chunk
 * adapter, with no glowing rim; under reduced motion the incoming side dissolves in by an ordered
 * dither. A ShaderMaterial's clone **shares its live uniform values**, so a contained simulation
 * keeps animating while masked, and the source material is never changed.
 */
/**
 * A live view of a source material's uniforms (#1350): reads, including entries the source's owner
 * replaces or adds at render time, always come from the source; the mask's own uniforms are kept
 * apart, so the source never gains them.
 */
export function liveUniforms(
  source: Record<string, THREE.IUniform>,
): Record<string, THREE.IUniform> {
  const own: Record<string, THREE.IUniform> = {};
  return new Proxy(source, {
    get: (target, key) => (key in own ? own[key as string] : Reflect.get(target, key)),
    set: (_target, key, value) => {
      own[key as string] = value as THREE.IUniform;
      return true;
    },
    has: (target, key) => key in own || key in target,
    ownKeys: (target) => [...new Set([...Reflect.ownKeys(target), ...Reflect.ownKeys(own)])],
    getOwnPropertyDescriptor: (target, key) =>
      key in own
        ? { value: own[key as string], writable: true, enumerable: true, configurable: true }
        : Reflect.getOwnPropertyDescriptor(target, key),
  });
}

/*
 * Points (#1350): the mask is decided per **sprite**, from its vertex position, so a particle
 * (a bubble, a star) appears or goes whole rather than being cut through; sprites here are a few
 * pixels across, so no per-pixel coverage is attempted.
 */
export const shaderSurfaceAdapter: MaskAdapter = {
  adapt(original, uniforms, role) {
    const made = original.clone();
    made.userData = original.userData;
    const shared = (original as THREE.ShaderMaterial).uniforms;
    if (shared) (made as THREE.ShaderMaterial).uniforms = liveUniforms(shared);
    const before = original.onBeforeCompile.bind(original);
    const key = original.customProgramCacheKey.bind(original);
    made.customProgramCacheKey = () => `${key()}|pairedMaskShader:${role}`;
    const outgoing = role === "outgoing" ? 1 : 0;
    made.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      Object.assign(shader.uniforms, uniforms, { matOutgoing: { value: outgoing } });
      shader.vertexShader = `varying vec3 matWorld;\n${shader.vertexShader}`.replace(
        /void main\(\)\s*\{/,
        `void main() {
        matWorld = (modelMatrix * vec4(position, 1.0)).xyz;`,
      );
      shader.fragmentShader = `varying vec3 matWorld;
        uniform float matProgress;
        uniform float matTime;
        uniform float matFrequency;
        uniform float matEdge;
        uniform float matReduced;
        uniform float matOutgoing;
        uniform mat4 matFrame;
        uniform vec3 matOrigin;
        ${NOISE}
        ${shader.fragmentShader}`.replace(
        /void main\(\)\s*\{/,
        `void main() {
        float matKeep;
        if (matReduced < 0.5) {
          vec3 matRay = normalize(matWorld - cameraPosition);
          vec3 matFacing = normalize(cameraPosition - matOrigin);
          float matAlong = dot(matOrigin - cameraPosition, matFacing) / min(dot(matRay, matFacing), -1e-4);
          vec3 matLocal = (matFrame * vec4(cameraPosition + matRay * matAlong, 1.0)).xyz;
          vec3 matAt = matLocal * matFrequency + vec3(0.0, matTime * 0.9, matTime * 0.4);
          matKeep = clamp(matFbm(matAt) * 1.6 + 0.5, 0.0, 1.0);
        } else {
          // An ordered 4x4 dither stands in for a fade a custom shader may not support.
          vec2 matCell = mod(floor(gl_FragCoord.xy), 4.0);
          matKeep = (matCell.x * 4.0 + mod(matCell.y * 5.0 + matCell.x, 4.0) * 1.0) / 16.0 + 0.03;
        }
        float matCut = mix(-matEdge, 1.0 + matEdge, matProgress);
        if (matOutgoing > 0.5 ? matKeep <= matCut : matKeep > matCut) discard;`,
      );
    };
    return made;
  },
};

maskAdapters.register("shaderSurface", shaderSurfaceAdapter);

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
  // Every drawn part resolves its adapter before anything is touched (#1208): its own declaration
  // (nearest `userData.maskAdapter` up to the look's root), else the look's. A part with neither,
  // or naming an unregistered one, is reported rather than left drawn whole.
  for (const [role, side] of sides) {
    let problem: string | null = null;
    side.root.traverse((node) => {
      if (problem || !drawnPart(node)) return;
      const name = adapterOf(node, side);
      if (!name) problem = `${role} look's ${node.name || node.type} declares no mask adapter`;
      else if (!maskAdapters.has(name))
        problem = `${role} look's mask adapter "${name}" is not registered`;
      else {
        // Its resolved adapter may refuse a material it can't adapt (#1336, #1338 reviews).
        const adapter = maskAdapters.get(name);
        for (const material of [
          (node as THREE.Mesh).material as THREE.Material | THREE.Material[],
        ].flat()) {
          const refused = adapter.refuse?.(material) ?? null;
          if (refused) problem ??= `${role} look: ${refused}`;
        }
      }
    });
    if (problem) return { ok: false, diagnostic: problem };
  }
  const uniforms: PairedMaskUniforms = {
    matProgress: { value: 0 },
    matTime: { value: 0 },
    matFrequency: { value: BLOBS / (2 * sharedRadius(mount, [outgoing, incoming])) },
    matEdge: { value: reduced ? 0 : EDGE },
    matGlow: { value: new THREE.Color(glow) },
    matReduced: { value: reduced ? 1 : 0 },
    matFrame: { value: new THREE.Matrix4() },
    matOrigin: { value: new THREE.Vector3() },
  };
  const swapped: {
    mesh: THREE.Mesh;
    material: THREE.Material | THREE.Material[];
    castShadow: boolean;
    renderOrder: number;
  }[] = [];
  const clones: THREE.Material[] = [];
  const incomingParts: THREE.Object3D[] = [];
  const outgoingLayers: number[] = [];
  for (const [role, side] of sides) {
    const made = new Map<string, Map<THREE.Material, THREE.Material>>();
    const adapterFor = (name: string) => {
      const adapter = maskAdapters.get(name);
      const byMaterial = made.get(name) ?? new Map<THREE.Material, THREE.Material>();
      made.set(name, byMaterial);
      return (material: THREE.Material) => {
        let clone = byMaterial.get(material);
        if (!clone) {
          clone = adapter.adapt(material, uniforms, role);
          byMaterial.set(material, clone);
          clones.push(clone);
        }
        return clone;
      };
    };
    side.root.traverse((node) => {
      if (!drawnPart(node)) return;
      const adapt = adapterFor(adapterOf(node, side)!);
      const object = node as THREE.Mesh;
      const material = object.material as THREE.Material | THREE.Material[];
      swapped.push({
        mesh: object,
        material,
        castShadow: object.castShadow,
        renderOrder: object.renderOrder,
      });
      object.material = Array.isArray(material) ? material.map(adapt) : adapt(material);
      // A shadow would show a look whole before it is.
      object.castShadow = false;
      // The fading incoming look draws over the outgoing one: placed after the loop, above every
      // outgoing layer (#1338 review).
      if (role === "incoming") incomingParts.push(object);
      else if ([material].flat().some(({ transparent }) => transparent))
        outgoingLayers.push(object.renderOrder);
      // The outgoing look writes no depth while it is faded over (#1264), so it draws after the
      // rest of the opaque scene: geometry behind it is already drawn and can't show through it
      // (#1273). The incoming look still draws over it, in the transparent pass.
      // Only its opaque parts: a transparent outgoing layer keeps drawing below the incoming
      // look, which is one step later (#1291).
      if (
        reduced &&
        role === "outgoing" &&
        ![material].flat().some(({ transparent }) => transparent)
      )
        object.renderOrder += outgoingDrawLate;
    });
  }
  // Under reduced motion the incoming look, shifted as a whole so its own layers keep their order,
  // draws after the outgoing look's last transparent layer (a crystal's print skin, say), so it
  // fades over all of it rather than under its artwork (#1338 review). The outgoing opaque parts
  // draw in the opaque pass before any of it.
  if (reduced && incomingParts.length) {
    const lowest = Math.min(...incomingParts.map(({ renderOrder }) => renderOrder));
    const shift = Math.max(1, Math.max(lowest, ...outgoingLayers) - lowest + 1);
    for (const part of incomingParts) part.renderOrder += shift;
  }
  const followMount = () => {
    mount.updateWorldMatrix(true, false);
    uniforms.matFrame.value.copy(mount.matrixWorld).invert();
    uniforms.matOrigin.value.setFromMatrixPosition(mount.matrixWorld);
  };
  followMount();

  let running = true;
  let elapsed = 0;
  const duration = reduced ? Math.min(seconds, 0.4) : seconds;
  const restore = () => {
    if (!running) return false;
    running = false;
    for (const { mesh, material, castShadow, renderOrder } of swapped) {
      mesh.material = material;
      mesh.castShadow = castShadow;
      mesh.renderOrder = renderOrder;
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
