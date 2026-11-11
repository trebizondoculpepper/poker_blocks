// Plays registered sound effects by id (#518): each through the provider its registry entry
// names, a pre-generated sample by default, or a live synthesised recipe. A sound with no audio
// yet is silent, so game code can call `playSfx` for every action before its audio exists.
import { soundEffects, type SoundEffectId } from "./sfx-registry";
import { sfxProviders, type PlayOptions, type SfxSettings } from "./sfx-providers";

export type { PlayOptions } from "./sfx-providers";

const effects = new Map(soundEffects.map((effect) => [effect.id, effect]));
const settings: SfxSettings = { volume: 0.7, muted: false, random: Math.random };

export function setSfxVolume(volume: number): void {
  settings.volume = Math.min(1, Math.max(0, volume));
}

export function setSfxMuted(value: boolean): void {
  settings.muted = value;
}

/** For tests: replace the cosmetic random source (variation, take choice). */
export function setSfxRandom(random: () => number): void {
  settings.random = random;
}

/** Plays one take of a sound, by its provider. Does nothing when muted or it has no audio. */
export function playSfx(id: SoundEffectId, options: PlayOptions = {}): void {
  if (settings.muted) return;
  const effect = effects.get(id);
  if (!effect) return;
  sfxProviders.get(effect.source?.provider ?? "sample")(effect, options, settings);
}
