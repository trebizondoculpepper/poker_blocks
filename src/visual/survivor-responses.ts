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

survivorResponses.register("flash", (target, config, reduced) =>
  createFlash([target], config as FlashConfig, reduced),
);
survivorResponses.register("shudder", (target, config, reduced) =>
  createShudder(target, config as ShudderConfig, reduced),
);
