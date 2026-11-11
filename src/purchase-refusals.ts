/**
 * How a refused purchase sounds (#481), keyed by the refusal's reason (`GameRun.purchaseVerdict`):
 * a registered handler owns each reason's presentation, so the controller asks for the sound and
 * never branches on why. A reason without one sounds like any other "no".
 */
import { Registry } from "./core/registry";
import type { SoundEffectId } from "./audio/sfx-registry";

export const refusalSounds = new Registry<SoundEffectId>("purchase refusal sound");
refusalSounds.register("unaffordable", "shop.buy.denied");
refusalSounds.register("rack-full", "shop.rack_full");

/** The sound for a refused purchase's reason. */
export const refusalSound = (reason: string): SoundEffectId =>
  refusalSounds.has(reason) ? refusalSounds.get(reason) : "action.denied";
