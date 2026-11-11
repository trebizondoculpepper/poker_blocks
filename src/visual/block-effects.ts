/**
 * Ongoing block effects (#464, #465): looks that keep emitting while a block is on the table,
 * such as smoke or dust. A material's appearance lists them (`effects`), each naming a handler
 * registered here with its own serializable configuration, so the view that hosts them never
 * names an effect or a material. See doc/game-architecture.md, "Ongoing block effects".
 *
 * Each effect's `object` lives in a world-space layer the host owns, never on the block, so what
 * it has emitted stays put as the block moves or turns. `update` reads the block's live world
 * matrix, so only new particles start from its current pose. Cosmetic only.
 */
import * as THREE from "three";
import { Registry } from "../core/registry";

/** One effect a material's look lists: a registered handler and its configuration. */
export type AppearanceEffect = { effect: string } & Record<string, unknown>;

export type BlockEffect = {
  /** Added to the host's world-space layer. */
  object: THREE.Object3D;
  /** Per frame: emit from `block`'s current pose and age what was emitted. */
  update(delta: number, block: THREE.Object3D, reducedMotion: boolean): void;
  dispose(): void;
};

export type BlockEffectContext = {
  /** A cosmetic random source, never the session's seeded stream. */
  random: () => number;
  /** The block's edge length in world units; configured distances are in block sizes. */
  size: number;
};

export type BlockEffectHandler = (
  config: AppearanceEffect,
  context: BlockEffectContext,
) => BlockEffect;

export const blockEffects = new Registry<BlockEffectHandler>("block effect");

/** Cosmetic randomness for effects: presentation, never the session's stream. */
export const cosmeticRandom = (): number => Math.random();

/** Build every effect a look lists. */
export function createBlockEffects(
  effects: readonly AppearanceEffect[],
  context: BlockEffectContext,
): BlockEffect[] {
  return effects.map((config) => blockEffects.get(config.effect)(config, context));
}
