/**
 * Flash and shudder (#441): two small reusable damage presentations. Each runs on any visual, so a
 * block that survives a blast (steel, #437) can flash and shudder in place, and each is also a
 * registered exit effect (src/visual/exit-presentation.ts) for a block that leaves. They decide
 * nothing: the model already has.
 *
 * - **flash { colour, intensity, seconds }:** the target glows `colour` and back, drawn as an
 *   additive overlay of each mesh's own geometry, so no material is changed, whatever its kind.
 *   The overlays go when it is disposed.
 * - **shudder { amplitude, seconds, frequency }:** the target object shakes about its own position,
 *   decaying to rest. Only its visual transform moves, never its grid cell; it puts the position
 *   back exactly when it ends or is stopped.
 *
 * Under reduced motion the shudder doesn't move and the flash doesn't pulse: both end at once.
 */
import * as THREE from "three";
import { exitEffects, type ExitEffectInstance } from "./exit-presentation";

export type FlashConfig = { colour?: number; intensity?: number; seconds?: number };
export type ShudderConfig = { amplitude?: number; seconds?: number; frequency?: number };

/**
 * Flash `targets`: each mesh under them gets an overlay, its own geometry drawn again in one shared
 * additive material whose opacity pulses up and back. Nothing about the original materials changes,
 * whatever kind they are; ending or disposing removes the overlays and frees the one material.
 */
export function createFlash(
  targets: readonly THREE.Object3D[],
  raw: FlashConfig = {},
  reducedMotion = false,
): ExitEffectInstance {
  const seconds = Math.max(raw.seconds ?? 0.25, 1e-3);
  const peak = Math.min(Math.max(raw.intensity ?? 0.8, 0), 1);
  const glow = new THREE.MeshBasicMaterial({
    color: raw.colour ?? 0xffffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const meshes: THREE.Mesh[] = [];
  for (const target of targets)
    target.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) meshes.push(mesh);
    });
  const overlays = reducedMotion
    ? []
    : meshes.map((mesh) => {
        const overlay = new THREE.Mesh(mesh.geometry, glow);
        overlay.renderOrder = mesh.renderOrder + 1;
        mesh.add(overlay);
        return overlay;
      });
  let elapsed = reducedMotion ? seconds : 0;
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    overlays.forEach((overlay) => overlay.removeFromParent());
    glow.dispose();
  };
  return {
    update(delta) {
      if (elapsed >= seconds) return false;
      elapsed = Math.min(elapsed + delta, seconds);
      // Up and back down: a single soft pulse.
      glow.opacity = peak * Math.sin(Math.PI * (elapsed / seconds));
      return elapsed < seconds;
    },
    finish() {
      elapsed = seconds;
      glow.opacity = 0;
    },
    dispose: remove,
  };
}

/** Shudder `target` about its own position; puts it back exactly when it ends or is disposed. */
export function createShudder(
  target: THREE.Object3D,
  raw: ShudderConfig = {},
  reducedMotion = false,
): ExitEffectInstance {
  const amplitude = raw.amplitude ?? 0.06;
  const seconds = Math.max(raw.seconds ?? 0.35, 1e-3);
  const frequency = raw.frequency ?? 28;
  const home = target.position.clone();
  let elapsed = reducedMotion ? seconds : 0;
  const restore = () => void target.position.copy(home);
  return {
    update(delta) {
      if (elapsed >= seconds) return false;
      elapsed = Math.min(elapsed + delta, seconds);
      const decay = 1 - elapsed / seconds;
      const phase = elapsed * frequency * Math.PI * 2;
      target.position
        .copy(home)
        .add(
          new THREE.Vector3(
            Math.sin(phase),
            Math.sin(phase * 1.3 + 1),
            Math.sin(phase * 0.7 + 2),
          ).multiplyScalar(amplitude * decay),
        );
      if (elapsed >= seconds) restore();
      return elapsed < seconds;
    },
    finish() {
      elapsed = seconds;
      restore();
    },
    dispose: restore,
  };
}

exitEffects.register("flash", ({ targets, reducedMotion }, raw) =>
  createFlash(targets, raw as FlashConfig, reducedMotion),
);

/** In an exit, every target shudders together. */
exitEffects.register("shudder", ({ targets, reducedMotion }, raw) => {
  const each = targets.map((target) => createShudder(target, raw as ShudderConfig, reducedMotion));
  return {
    update: (delta) => each.map((one) => one.update(delta)).some(Boolean),
    finish: () => each.forEach((one) => one.finish()),
    dispose: () => each.forEach((one) => one.dispose()),
  };
});
