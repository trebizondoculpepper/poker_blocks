/**
 * The fade exit effect (#440): its targets (the whole block, its shell or its contents, as the
 * step configures, src/visual/exit-presentation.ts) fade from their current opacity to nothing.
 *
 * The departing visual and its materials belong to the exit (the #439 handover: each block builds
 * its own materials, and the exit releases them when it ends), so the fade works on them in place.
 * It never copies a material, so every material keeps its shader hooks, program key and live
 * uniforms exactly, whatever kind it is. It remembers each one's opacity, transparency and depth
 * writing, and puts them back on dispose, before the owner's `release`. Materials that ignore
 * `opacity` (some custom shaders) keep their look until the exit ends. Under reduced motion it
 * ends at once, invisible. It decides nothing about the block: presentation only.
 */
import type * as THREE from "three";
import { exitEffects } from "./exit-presentation";

export type FadeConfig = { seconds?: number };

const defaultSeconds = 0.4;

/**
 * Shared per-material fade state (#490 review): overlapping fades compose instead of overwriting.
 * The material's original settings are saved once, by the first fade to touch it; its opacity is
 * that original times every active fade's remaining share; the original settings come back only
 * when the last fade holding it is disposed.
 */
type Shared = {
  saved: { opacity: number; transparent: boolean; depthWrite: boolean; alphaTest: number };
  shares: Map<object, number>;
};
const shared = new WeakMap<THREE.Material, Shared>();

function hold(material: THREE.Material, holder: object): void {
  let state = shared.get(material);
  if (!state) {
    state = {
      saved: {
        opacity: material.opacity,
        transparent: material.transparent,
        depthWrite: material.depthWrite,
        alphaTest: material.alphaTest,
      },
      shares: new Map(),
    };
    shared.set(material, state);
    material.transparent = true;
    material.depthWrite = false;
    material.needsUpdate = true;
  }
  state.shares.set(holder, 1);
}

/** The material's opacity: its original times each holder's remaining share. */
function apply(material: THREE.Material, state: Shared): void {
  let share = 1;
  for (const each of state.shares.values()) share *= each;
  material.opacity = state.saved.opacity * share;
  // A cut-out threshold scales with the fade, so cut-out faces fade smoothly to nothing instead
  // of vanishing once opacity drops below it (#490 review).
  material.alphaTest = state.saved.alphaTest * share;
}

function setShare(material: THREE.Material, holder: object, share: number): void {
  const state = shared.get(material)!;
  state.shares.set(holder, share);
  apply(material, state);
}

function release(material: THREE.Material, holder: object): void {
  const state = shared.get(material);
  if (!state?.shares.delete(holder)) return;
  if (state.shares.size) return apply(material, state);
  shared.delete(material);
  Object.assign(material, state.saved);
  material.needsUpdate = true;
}

exitEffects.register("fade", ({ targets, excluded, reducedMotion, ownsObject }, raw) => {
  const seconds = Math.max((raw as FadeConfig | undefined)?.seconds ?? defaultSeconds, 1e-3);
  const self = {};
  const faded = new Set<THREE.Material>();
  // What the target leaves out stays out even when nested inside it: a shell-only fade never
  // reaches contents parented under the shell; a whole fade leaves nothing out (#490 review).
  const aimed = new Set(targets);
  const outside = new Set(excluded.filter((part) => !aimed.has(part)));
  const visit = (object: THREE.Object3D) => {
    if (outside.has(object)) return;
    // Only the departing block's own materials fade, never a sibling effect's overlay or
    // particles (#490 review; ownership from #512).
    if (ownsObject(object))
      for (const each of [(object as THREE.Mesh).material ?? []].flat()) {
        if (faded.has(each)) continue;
        faded.add(each);
        hold(each, self);
      }
    object.children.forEach(visit);
  };
  targets.forEach(visit);
  let elapsed = 0;
  const show = (fraction: number) => {
    for (const material of faded) setShare(material, self, 1 - fraction);
  };
  const finish = () => {
    elapsed = seconds;
    show(1);
  };
  if (reducedMotion) finish();
  return {
    update(delta) {
      if (elapsed >= seconds) return false;
      elapsed = Math.min(elapsed + delta, seconds);
      show(elapsed / seconds);
      return elapsed < seconds;
    },
    finish,
    dispose() {
      for (const material of faded) release(material, self);
    },
  };
});
