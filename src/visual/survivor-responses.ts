/**
 * Registered survivor responses (#1174; doc/triggered-presentation.md, "Victim exit and survival
 * feedback are separate capabilities"). A material's `appearance.survive` lists the responses a
 * block of that look plays, in place on its live visual, when it resists a destruction. Each is
 * registered by name and brings its own behaviour; generic code dispatches to it and never asks
 * what material, trait or cause it is serving.
 *
 * Responses own additive visual channels only (an overlay, a visual offset), never grid
 * coordinates, materials or bonuses: the model has already decided the block stays.
 */
import type * as THREE from "three";
import { Registry } from "../core/registry";
import { unitMs } from "../visual-events/scheduler";
import type { ExitEffectInstance } from "./exit-presentation";
import { createFlash, createShudder, type FlashConfig, type ShudderConfig } from "./flash-shudder";

/** One step of a material's survivor feedback: a registered response and its configuration. */
export type SurvivorResponseStep = { response: string; config?: unknown };

export type SurvivorResponse = (
  target: THREE.Object3D,
  config: unknown,
  reducedMotion: boolean,
) => ExitEffectInstance;

export const survivorResponses = new Registry<SurvivorResponse>("survivor response");

/**
 * Durations are configured in game-time units (1/15 s, #541) and adapted to the existing effects'
 * seconds here, at the presentation boundary (#1174 review).
 */
export type TimedInUnits<T> = Omit<T, "seconds"> & { units?: number };
const inSeconds = <T extends { seconds?: number }>(config: unknown): T => {
  const { units, ...rest } = (config ?? {}) as TimedInUnits<T>;
  return { ...rest, ...(units === undefined ? {} : { seconds: (units * unitMs) / 1000 }) } as T;
};

survivorResponses.register("flash", (target, config, reduced) =>
  createFlash([target], inSeconds<FlashConfig>(config), reduced),
);
survivorResponses.register("shudder", (target, config, reduced) =>
  createShudder(target, inSeconds<ShudderConfig>(config), reduced),
);
