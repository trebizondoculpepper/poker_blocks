/**
 * The fade exit effect (#440): its targets (the whole block, its shell or its contents, as the
 * step configures, src/visual/exit-presentation.ts) fade from their current opacity to nothing.
 *
 * It never touches a material that might be shared: on start it gives each mesh under its targets
 * a private copy of its material(s) and fades those, and on dispose it puts the originals back and
 * frees the copies, so the owner's `release` frees exactly what it made. Materials that draw no
 * notice of `opacity` (some custom shaders) keep their look until the exit ends. Under reduced
 * motion it ends at once, invisible. It decides nothing about the block: presentation only.
 */
import * as THREE from "three";
import { exitEffects } from "./exit-presentation";

export type FadeConfig = { seconds?: number };

const defaultSeconds = 0.4;

exitEffects.register("fade", ({ targets, reducedMotion }, raw) => {
  const seconds = Math.max((raw as FadeConfig | undefined)?.seconds ?? defaultSeconds, 1e-3);
  const swapped: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[] }[] = [];
  const faded: { material: THREE.Material; from: number }[] = [];
  const copy = (material: THREE.Material) => {
    const own = material.clone();
    // clone() drops shader hooks and copies uniforms: keep the original's hook and program key
    // (a refractive fluid clips itself there) and share its live uniforms, so the copy draws
    // exactly as the original did, only fading (#490 review).
    own.onBeforeCompile = material.onBeforeCompile.bind(material);
    own.customProgramCacheKey = material.customProgramCacheKey.bind(material);
    if (material instanceof THREE.ShaderMaterial)
      (own as THREE.ShaderMaterial).uniforms = material.uniforms;
    own.transparent = true;
    own.depthWrite = false;
    faded.push({ material: own, from: material.opacity });
    return own;
  };
  for (const target of targets)
    target.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.material) return;
      swapped.push({ mesh, original: mesh.material });
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copy) : copy(mesh.material);
    });
  let elapsed = 0;
  const show = (fraction: number) => {
    for (const { material, from } of faded) material.opacity = from * (1 - fraction);
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
      for (const { mesh, original } of swapped) mesh.material = original;
      for (const { material } of faded) material.dispose();
    },
  };
});
