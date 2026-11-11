/**
 * Flash and shudder (#441): two small reusable damage presentations. Each runs on any visual, so a
 * block that survives a blast (steel, #437) can flash and shudder in place, and each is also a
 * registered exit effect (src/visual/exit-presentation.ts) for a block that leaves. They decide
 * nothing: the model already has.
 *
 * - **flash { colour, intensity, seconds }:** the target's materials glow toward `colour` and back,
 *   through their emissive colour where they have one. It changes the materials in place and puts
 *   every emissive colour and intensity back exactly when it ends or is stopped.
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

/** A material that can glow: one with an emissive colour. */
type Glowing = THREE.Material & { emissive: THREE.Color; emissiveIntensity: number };
const glows = (material: THREE.Material): material is Glowing =>
  (material as Partial<Glowing>).emissive instanceof THREE.Color;

/** Flash the materials under `targets`; restores them exactly when it ends or is disposed. */
export function createFlash(
  targets: readonly THREE.Object3D[],
  raw: FlashConfig = {},
  reducedMotion = false,
): ExitEffectInstance {
  const colour = new THREE.Color(raw.colour ?? 0xffffff);
  const intensity = raw.intensity ?? 1.5;
  const seconds = Math.max(raw.seconds ?? 0.25, 1e-3);
  const saved = new Map<Glowing, { emissive: THREE.Color; emissiveIntensity: number }>();
  for (const target of targets)
    target.traverse((child) => {
      for (const material of [(child as THREE.Mesh).material ?? []].flat())
        if (glows(material) && !saved.has(material))
          saved.set(material, {
            emissive: material.emissive.clone(),
            emissiveIntensity: material.emissiveIntensity,
          });
    });
  let elapsed = reducedMotion ? seconds : 0;
  const restore = () => {
    for (const [material, before] of saved) {
      material.emissive.copy(before.emissive);
      material.emissiveIntensity = before.emissiveIntensity;
    }
  };
  const show = () => {
    // Up and back down: a single soft pulse.
    const glow = Math.sin(Math.PI * Math.min(elapsed / seconds, 1));
    for (const [material, before] of saved) {
      material.emissive.copy(before.emissive).lerp(colour, glow);
      material.emissiveIntensity =
        before.emissiveIntensity + (intensity - before.emissiveIntensity) * glow;
    }
  };
  return {
    update(delta) {
      if (elapsed >= seconds) return false;
      elapsed = Math.min(elapsed + delta, seconds);
      show();
      return elapsed < seconds;
    },
    finish() {
      elapsed = seconds;
      restore();
    },
    dispose: restore,
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
