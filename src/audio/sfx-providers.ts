/**
 * Where a sound effect's audio comes from (#518): a registry of providers keyed by name, each
 * playing a registered sound by its own means. `sample` plays the sound's pre-generated takes (its
 * placeholder's until it has its own); `synth` plays a registered recipe live on the shared audio
 * context. A sound names its provider in its registry entry (`source`, default `sample`), so
 * `playSfx` never asks a sound's id or origin.
 *
 * Shared by both: the master volume and mute (`setSfxVolume`, `setSfxMuted`). Synthesised voices go
 * through one sound-effect bus on the shared context, are capped (`maxSynthVoices`; a new voice
 * over the cap is dropped rather than cutting others off) and are released when they end.
 */
import { Registry } from "../core/registry";
import { resumeSharedAudio, sharedAudioContext } from "./audio-context";
import { sfxFileNames, soundEffects, type SoundEffect } from "./sfx-registry";
import { synthRecipes, type SynthVoice } from "./synth";

export type PlayOptions = {
  /** Playback-rate multiplier; above 1 raises the pitch. */
  rate?: number;
  /** Random pitch spread, e.g. 0.06 for ±6%. Default 0.04. */
  jitter?: number;
  /** 0 to 1, multiplied by the master volume. */
  volume?: number;
};

/** What every provider shares: the master level, and the cosmetic random source. */
export type SfxSettings = { volume: number; muted: boolean; random: () => number };

export type SfxProvider = (
  effect: SoundEffect,
  options: PlayOptions,
  settings: SfxSettings,
) => void;
export const sfxProviders = new Registry<SfxProvider>("sound provider");

// ----- Samples: the pre-generated takes, as before ------------------------------------------

const urlByFile = new Map(
  Object.entries(
    import.meta.glob<string>("../assets/sfx/*.mp3", {
      eager: true,
      query: "?url",
      import: "default",
    }),
  ).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1), url]),
);
const ownTakes = new Map(
  soundEffects.map((effect) => [
    effect.id,
    sfxFileNames(effect).flatMap((name) => urlByFile.get(name) ?? []),
  ]),
);
// A sound with no audio yet plays its placeholder's takes, if it names one (#232).
const takesById = new Map(
  soundEffects.map((effect) => {
    const own = ownTakes.get(effect.id) ?? [];
    const stand = effect.placeholder ? (ownTakes.get(effect.placeholder) ?? []) : [];
    return [effect.id, own.length > 0 ? own : stand];
  }),
);

sfxProviders.register("sample", (effect, options, { volume, random }) => {
  const takes = takesById.get(effect.id) ?? [];
  if (takes.length === 0) return;
  const audio = new Audio(takes[Math.floor(random() * takes.length)]);
  const jitter = options.jitter ?? 0.04;
  audio.preservesPitch = false;
  audio.playbackRate = (options.rate ?? 1) * (1 + (random() * 2 - 1) * jitter);
  audio.volume = volume * (options.volume ?? 1);
  // Browsers block audio until the first user gesture; a refused play is harmless.
  audio.play().catch(() => {});
});

// ----- Synthesis: registered recipes, live on the shared context ---------------------------

/** At most this many synthesised voices sound at once; more are dropped, not queued. */
export const maxSynthVoices = 12;
const live = new Set<SynthVoice>();
let bus: { context: AudioContext; gain: GainNode } | null = null;

/** The sound-effect bus on the shared context, made on first use. */
function sfxBus(): { context: AudioContext; gain: GainNode } {
  if (!bus) {
    const context = sharedAudioContext();
    const gain = context.createGain();
    gain.connect(context.destination);
    bus = { context, gain };
  }
  return bus;
}

sfxProviders.register("synth", (effect, options, { volume, random }) => {
  if (live.size >= maxSynthVoices) return;
  const { recipe, config } = effect.source!.config as { recipe: string; config?: unknown };
  resumeSharedAudio();
  const { context, gain } = sfxBus();
  gain.gain.value = volume;
  const voice = synthRecipes.get(recipe)(
    {
      context,
      output: gain,
      at: context.currentTime,
      volume: options.volume ?? 1,
      rate: options.rate ?? 1,
      random,
    },
    config,
  );
  live.add(voice);
  // A voice is released when its last source ends, so finished voices never pile up.
  let left = voice.sources.length;
  for (const source of voice.sources)
    source.addEventListener("ended", () => {
      left -= 1;
      if (left <= 0) live.delete(voice);
    });
  if (!voice.sources.length) live.delete(voice);
});

/** How many synthesised voices are sounding now. */
export const liveSynthVoices = (): number => live.size;

/** Stop every synthesised voice now (scene exit, a stop button). */
export function stopSynthVoices(): void {
  for (const voice of live) for (const source of voice.sources) source.stop();
  live.clear();
}

/** For tests: forget the bus and every voice. */
export function resetSynthForTests(): void {
  live.clear();
  bus = null;
}
