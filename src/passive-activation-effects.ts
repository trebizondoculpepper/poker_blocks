/**
 * Passive activation effects (#81): what a rack token does when one of its passive's rules
 * fires. A category names an effect and configures it (`passive-categories.ts`); each effect is
 * a registered handler, so the rack never asks which category or passive it is animating.
 * Presentation only: an effect shows an outcome the rules already decided.
 */
import * as THREE from "three";
import { Registry } from "./core/registry";

/** A category's activation look: a registered effect and its colour. */
export type TokenEffectConfig = { id: string; colour: string };

/** What an effect may change on the token for one frame. */
export type TokenEffectTarget = {
  /** Multiplies the token's resting scale. */
  scale: number;
  /** Glow added to the token's faces, 0 to 1, in `colour`. */
  glow: number;
};

/**
 * One frame of an effect: `progress` runs 0 → 1 over the effect's length. With reduced motion
 * the effect keeps its glow and drops its movement.
 */
type TokenEffect = {
  milliseconds: number;
  frame(progress: number, reducedMotion: boolean): TokenEffectTarget;
};

export const tokenEffects = new Registry<TokenEffect>("passive activation effect");

const swell = (progress: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, progress)));

/** One swell: the token grows a little and glows, then settles. */
tokenEffects.register("pulse", {
  milliseconds: 450,
  frame: (progress, reducedMotion) => ({
    scale: reducedMotion ? 1 : 1 + 0.22 * swell(progress),
    glow: 0.9 * swell(progress),
  }),
});
/** Two quick swells, the second softer: an echo, for a passive that repeats something. */
tokenEffects.register("echo", {
  milliseconds: 520,
  frame: (progress, reducedMotion) => {
    const first = swell(progress * 2);
    const second = 0.6 * swell(progress * 2 - 1);
    const strength = Math.max(first, second);
    return { scale: reducedMotion ? 1 : 1 + 0.18 * strength, glow: 0.9 * strength };
  },
});

/** Apply a frame's glow to a token's face materials. */
export function applyGlow(
  materials: readonly THREE.MeshStandardMaterial[],
  colour: string,
  glow: number,
): void {
  for (const material of materials) {
    material.emissive.set(colour);
    material.emissiveIntensity = glow;
  }
}
