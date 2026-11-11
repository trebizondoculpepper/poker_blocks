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

/** Every live flash overlay, so a later flash never treats one as part of its target. */
const flashOverlays = new WeakSet<THREE.Object3D>();

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
  // The target's own meshes, once each: never another flash's overlay, which would draw its
  // geometry twice and vanish part-way when that flash ends (#511 review).
  const found = new Set<THREE.Mesh>();
  for (const target of targets)
    target.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && !flashOverlays.has(mesh)) found.add(mesh);
    });
  const meshes = [...found];
  const overlays = reducedMotion
    ? []
    : meshes.map((mesh) => {
        const overlay = new THREE.Mesh(mesh.geometry, glow);
        flashOverlays.add(overlay);
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

/**
 * Shudder `target` about wherever it is: purely additive, so it composes with any other motion
 * (a fracture's flight, another shudder). Each frame it takes back its last offset and adds its
 * new one, never resetting the position; when it ends or is disposed it takes back only its own
 * last offset (#512 review).
 */
export function createShudder(
  target: THREE.Object3D,
  raw: ShudderConfig = {},
  reducedMotion = false,
): ExitEffectInstance {
  const amplitude = raw.amplitude ?? 0.06;
  const seconds = Math.max(raw.seconds ?? 0.35, 1e-3);
  const frequency = raw.frequency ?? 28;
  const applied = new THREE.Vector3();
  const next = new THREE.Vector3();
  let elapsed = reducedMotion ? seconds : 0;
  let ended = false;
  const apply = (offset: THREE.Vector3) => {
    target.position.sub(applied).add(offset);
    applied.copy(offset);
  };
  const end = () => {
    if (ended) return;
    ended = true;
    apply(next.set(0, 0, 0));
  };
  return {
    update(delta) {
      if (elapsed >= seconds) return false;
      elapsed = Math.min(elapsed + delta, seconds);
      const decay = 1 - elapsed / seconds;
      const phase = elapsed * frequency * Math.PI * 2;
      apply(
        next
          .set(Math.sin(phase), Math.sin(phase * 1.3 + 1), Math.sin(phase * 0.7 + 2))
          .multiplyScalar(amplitude * decay),
      );
      if (elapsed >= seconds) end();
      return elapsed < seconds;
    },
    finish() {
      elapsed = seconds;
      end();
    },
    dispose: end,
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
