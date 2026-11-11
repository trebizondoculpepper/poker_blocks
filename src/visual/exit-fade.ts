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

exitEffects.register("fade", ({ targets, reducedMotion }, raw) => {
  const seconds = Math.max((raw as FadeConfig | undefined)?.seconds ?? defaultSeconds, 1e-3);
  const faded = new Map<
    THREE.Material,
    { opacity: number; transparent: boolean; depthWrite: boolean }
  >();
  for (const target of targets)
    target.traverse((child) => {
      const material = (child as THREE.Mesh).material;
      for (const each of [material ?? []].flat()) {
        if (faded.has(each)) continue;
        faded.set(each, {
          opacity: each.opacity,
          transparent: each.transparent,
          depthWrite: each.depthWrite,
        });
        each.transparent = true;
        each.depthWrite = false;
        each.needsUpdate = true;
      }
    });
  let elapsed = 0;
  const show = (fraction: number) => {
    for (const [material, { opacity }] of faded) material.opacity = opacity * (1 - fraction);
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
      for (const [material, saved] of faded) {
        Object.assign(material, saved);
        material.needsUpdate = true;
      }
    },
  };
});
