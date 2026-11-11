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

/** A band-pass filter around `hz` with quality `q`. */
export function bandpass({ context }: SynthVoiceContext, hz: number, q: number): BiquadFilterNode {
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = hz;
  filter.Q.value = q;
  return filter;
}

export type PopConfig = {
  /** The report's band centre (Hz) and its filter quality. */
  band: number;
  q: number;
  /** How long the report takes to die away (s), and its peak level. */
  decay: number;
  level: number;
  /** The low thump under it: pitch it settles to (Hz) and how long it lasts (s). */
  thump: [number, number];
  /** How far each voice may wander from these (fractions), so rapid pops never sound alike. */
  spread: { band: number; decay: number; level: number; thump: number };
};

/**
 * A pop (#519): a sharp report of band-passed noise over a low thump that drops in pitch, as a
 * bright discharge sounds. Adapted from Encabulator's dazzle click (band 1400, Q 0.6, decay 0.07,
 * level 0.55, thump 110 Hz over 0.09 s); its routing isn't copied, only its intent. Each voice
 * varies its band, decay, level and thump a little by the cosmetic random source, so a rapid run
 * of 3 to 6 pops keeps its character without repeating. Levels leave headroom so several
 * overlapping voices don't clip on the shared bus.
 */
synthRecipes.register("pop", (voice, raw) => {
  const config = raw as PopConfig;
  const { at, random, rate } = voice;
  const level = vary(config.level, config.spread.level, random) * voice.volume;
  const decay = vary(config.decay, config.spread.decay, random);
  const report = noiseBurst(voice, decay + 0.02);
  report.playbackRate.value = rate;
  report
    .connect(bandpass(voice, vary(config.band, config.spread.band, random) * rate, config.q))
    .connect(envelope(voice, level, decay))
    .connect(voice.output);
  const [hz, thumpDecay] = config.thump;
  const settle = vary(hz, config.spread.thump, random) * rate;
  const thump = tone(voice, settle * 1.6);
  thump.frequency.setValueAtTime(settle * 1.6, at);
  thump.frequency.exponentialRampToValueAtTime(settle, at + thumpDecay);
  thump.connect(envelope(voice, level * 0.8, thumpDecay)).connect(voice.output);
  report.start(at);
  thump.start(at);
  return { sources: [report, thump], endsAt: at + Math.max(decay, thumpDecay) + 0.03 };
});
