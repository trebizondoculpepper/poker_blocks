/**
 * Live sound synthesis (#518): small reusable Web Audio building blocks and a registry of
 * recipes made from them. A recipe plays one short voice into the sound-effect bus it is given
 * and returns the nodes to stop and the time it ends, so the synth provider can bound and clean up
 * voices. This is enough for short effects like the dazzle pop (#519), not a synth workstation.
 *
 * Variation is cosmetic: a recipe gets a random source (presentation randomness, never the run's
 * seeded stream), which tests replace with a fixed one.
 */
import { Registry } from "../core/registry";

/** What a recipe has to play with. */
export type SynthVoiceContext = {
  context: AudioContext;
  /** Where the voice connects: the shared sound-effect bus (volume and mute live there). */
  output: AudioNode;
  /** When to start, in the context's time. */
  at: number;
  /** 0 to 1, this play's own level on top of the bus. */
  volume: number;
  /** Playback-rate multiplier from the caller (above 1 is higher), as samples take it. */
  rate: number;
  random: () => number;
};

/** A voice once started: the sources to stop early, and when it ends by itself. */
export type SynthVoice = { sources: readonly AudioScheduledSourceNode[]; endsAt: number };

export type SynthRecipe = (voice: SynthVoiceContext, config: unknown) => SynthVoice;
export const synthRecipes = new Registry<SynthRecipe>("synth recipe");

/** A value spread by ± `spread` (a fraction) using the voice's random source. */
export const vary = (value: number, spread: number, random: () => number): number =>
  value * (1 + (random() * 2 - 1) * spread);

/** A gain envelope: silent, up to `peak` almost at once, then decaying over `decay` seconds. */
export function envelope(
  { context, at }: SynthVoiceContext,
  peak: number,
  decay: number,
): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peak, at + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.002 + decay);
  return gain;
}

/** A short burst of white noise, `seconds` long, made into a buffer for this voice. */
export function noiseBurst(voice: SynthVoiceContext, seconds: number): AudioBufferSourceNode {
  const { context, random } = voice;
  const length = Math.max(1, Math.ceil(seconds * context.sampleRate));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = random() * 2 - 1;
  const source = context.createBufferSource();
  source.buffer = buffer;
  return source;
}

/** A sine tone at `hz`. */
export function tone({ context }: SynthVoiceContext, hz: number): OscillatorNode {
  const oscillator = context.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.value = hz;
  return oscillator;
}
