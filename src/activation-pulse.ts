/**
 * The activation pulse (#485): when a rule fires, the thing it belongs to swells and glows. One
 * reusable pulse composed onto any object (a passive's rack token, a card on the field), so the
 * rack and the field are hosts, not owners of pulse logic. See doc/game-architecture.md,
 * "Activation pulse".
 *
 * - **Given:** a mount (the object to scale and the face materials to glow) and the item's own
 *   activation config. The effect is a registered token effect, which says how long it lasts and
 *   its scale and glow at each moment.
 * - **Lifecycle:** `start`, then `frame` each frame; at its end it puts the object back. It
 *   captures the resting scale and emissive state when it starts and restores them when it ends
 *   or is stopped.
 * - **Composes:** it only multiplies the resting scale. A scale someone else set mid-pulse (an
 *   arrival tween, a spring) becomes the new rest rather than being overwritten.
 * - **Repeats** restart the timing and keep the first captured rest, so nothing ratchets.
 * - **Silent:** the host plays the activation's sound once; the pulse never does.
 *
 * Presentation only: it shows an activation the rules already decided.
 */
import * as THREE from "three";
import type { SoundEffectId } from "./audio/sfx-registry";
import { applyGlow, tokenEffects, type TokenEffectConfig } from "./passive-activation-effects";

/** An item's activation look: a registered token effect and colour, and its sound. */
export type ActivationConfig = { effect: TokenEffectConfig; sfx: SoundEffectId };

/** Where a pulse shows: the object it scales and the face materials it glows. */
export type PulseMount = {
  object: THREE.Object3D;
  materials: readonly THREE.MeshStandardMaterial[];
};

export type ActivationPulse = {
  /** Begin (or restart) the pulse at `now`, in milliseconds. */
  start(effect: TokenEffectConfig, now: number): void;
  /** Advance to `now`; at the end the object is put back. */
  frame(now: number, reducedMotion: boolean): void;
  /** End at once and put the object back (the item leaves, the scene exits). */
  stop(): void;
  /** Whether a pulse is playing. */
  readonly running: boolean;
};

/** How long an effect lasts, in milliseconds, so a label shown alongside can last as long. */
export const pulseMilliseconds = (effect: TokenEffectConfig): number =>
  tokenEffects.get(effect.id).milliseconds;

type Playing = {
  effect: TokenEffectConfig;
  startedAt: number;
  rest: THREE.Vector3;
  /** The scale the pulse last wrote, to tell whether someone else has moved it since. */
  written: THREE.Vector3;
  emissive: { material: THREE.MeshStandardMaterial; colour: THREE.Color; intensity: number }[];
};

export function createActivationPulse(mount: PulseMount): ActivationPulse {
  let playing: Playing | null = null;

  function putBack(): void {
    if (!playing) return;
    const { object } = mount;
    // Restore the rest unless someone else has set the scale since the pulse last wrote it.
    if (object.scale.equals(playing.written)) object.scale.copy(playing.rest);
    for (const { material, colour, intensity } of playing.emissive) {
      material.emissive.copy(colour);
      material.emissiveIntensity = intensity;
    }
    playing = null;
  }

  return {
    start(effect, now) {
      const scale = mount.object.scale;
      // A repeat keeps the rest it captured first, taking any scale set since as the new rest.
      const rest = !playing
        ? scale.clone()
        : scale.equals(playing.written)
          ? playing.rest
          : scale.clone();
      playing = {
        effect,
        startedAt: now,
        rest,
        written: scale.clone(),
        emissive:
          playing?.emissive ??
          [...new Set(mount.materials)].map((material) => ({
            material,
            colour: material.emissive.clone(),
            intensity: material.emissiveIntensity,
          })),
      };
    },
    frame(now, reducedMotion) {
      if (!playing) return;
      const handler = tokenEffects.get(playing.effect.id);
      const progress = Math.max(0, (now - playing.startedAt) / handler.milliseconds);
      if (progress >= 1) return putBack();
      const scale = mount.object.scale;
      if (!scale.equals(playing.written)) playing.rest.copy(scale);
      const look = handler.frame(progress, reducedMotion);
      scale.copy(playing.rest).multiplyScalar(look.scale);
      playing.written.copy(scale);
      applyGlow(mount.materials, playing.effect.colour, look.glow);
    },
    stop: putBack,
    get running() {
      return playing !== null;
    },
  };
}
