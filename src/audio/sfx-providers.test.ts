import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { setAudioContextFactory } from "./audio-context";
import { soundEffects, type SoundEffect } from "./sfx-registry";
import {
  liveSynthVoices,
  maxSynthVoices,
  resetSynthForTests,
  sfxProviders,
  stopSynthVoices,
} from "./sfx-providers";
import { envelope, noiseBurst, synthRecipes, tone, vary } from "./synth";

/** A minimal stand-in for Web Audio: enough nodes to build and end voices. */
function fakeContext() {
  const sources: { ended: () => void; stopped: boolean }[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const node = () => ({ connect: vi.fn((next: unknown) => next) });
  const source = () => {
    const listeners: (() => void)[] = [];
    const made = {
      ...node(),
      buffer: null as unknown,
      frequency: param(),
      type: "",
      start: vi.fn(),
      stop: vi.fn(() => (entry.stopped = true)),
      addEventListener: (_: string, listener: () => void) => listeners.push(listener),
    };
    const entry = { ended: () => listeners.forEach((each) => each()), stopped: false };
    sources.push(entry);
    return made;
  };
  const context = {
    currentTime: 1,
    sampleRate: 8000,
    state: "running",
    destination: node(),
    resume: vi.fn(async () => {}),
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), frequency: param(), Q: param(), type: "" }),
    createBuffer: (_c: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: source,
    createOscillator: source,
  };
  return { context: context as unknown as AudioContext, sources };
}

// A test recipe built from the shared primitives: a noise burst and a tone through envelopes.
synthRecipes.register("test-pop", (voice, raw) => {
  const { pitch } = raw as { pitch: number };
  const noise = noiseBurst(voice, 0.05);
  const thump = tone(voice, vary(pitch, 0.1, voice.random));
  noise.connect(envelope(voice, voice.volume, 0.05)).connect(voice.output);
  thump.connect(envelope(voice, voice.volume * 0.5, 0.08)).connect(voice.output);
  noise.start(voice.at);
  thump.start(voice.at);
  return { sources: [noise, thump], endsAt: voice.at + 0.1 };
});
const pop: SoundEffect = {
  id: "test.pop",
  name: "Pop",
  family: "test",
  description: "A test pop",
  source: { provider: "synth", config: { recipe: "test-pop", config: { pitch: 110 } } },
};
const settings = { volume: 0.5, muted: false, random: () => 0.5 };

describe("mixed sample and synthesised sound effects (#518)", () => {
  let fake: ReturnType<typeof fakeContext>;
  beforeEach(() => {
    fake = fakeContext();
    setAudioContextFactory(() => fake.context);
    resetSynthForTests();
  });
  afterEach(() => resetSynthForTests());

  it("has both providers registered, and every registered sound names a known one", () => {
    expect(sfxProviders.has("sample")).toBe(true);
    expect(sfxProviders.has("synth")).toBe(true);
    for (const effect of soundEffects)
      expect(sfxProviders.has(effect.source?.provider ?? "sample")).toBe(true);
  });

  it("plays a synthesised sound live on the one shared context, through the sound-effect bus", () => {
    const make = vi.fn(() => fake.context);
    setAudioContextFactory(make);
    sfxProviders.get("synth")(pop, {}, settings);
    sfxProviders.get("synth")(pop, {}, settings);
    expect(make).toHaveBeenCalledTimes(1);
    expect(fake.sources).toHaveLength(4);
    expect(liveSynthVoices()).toBe(2);
  });

  it("releases a voice when its sources end, so rapid pops never pile up", () => {
    sfxProviders.get("synth")(pop, {}, settings);
    expect(liveSynthVoices()).toBe(1);
    fake.sources.forEach((source) => source.ended());
    expect(liveSynthVoices()).toBe(0);
  });

  it("caps how many voices sound at once, dropping new ones rather than cutting others off", () => {
    for (let i = 0; i < maxSynthVoices + 5; i++) sfxProviders.get("synth")(pop, {}, settings);
    expect(liveSynthVoices()).toBe(maxSynthVoices);
    expect(fake.sources.every(({ stopped }) => !stopped)).toBe(true);
  });

  it("stops every voice on request (scene exit)", () => {
    sfxProviders.get("synth")(pop, {}, settings);
    stopSynthVoices();
    expect(fake.sources.every(({ stopped }) => stopped)).toBe(true);
    expect(liveSynthVoices()).toBe(0);
  });

  it("varies by the injected cosmetic random source, deterministically", () => {
    expect(vary(100, 0.1, () => 0.5)).toBe(100);
    expect(vary(100, 0.1, () => 1)).toBeCloseTo(110);
    expect(vary(100, 0.1, () => 0)).toBeCloseTo(90);
  });
});
