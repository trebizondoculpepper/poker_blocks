import { describe, expect, it, vi } from "vite-plus/test";
import { soundEffects } from "./sfx-registry";
import { synthRecipes, type PopConfig, type SynthVoiceContext } from "./synth";

/** A recording stand-in for the Web Audio nodes a pop uses. */
function recordingVoice(random: () => number) {
  const peaks: number[] = [];
  const bands: number[] = [];
  const glides: number[][] = [];
  const param = (onSet?: (value: number) => void) => ({
    value: 0,
    setValueAtTime: vi.fn((value: number) => onSet?.(value)),
    linearRampToValueAtTime: vi.fn((value: number) => onSet?.(value)),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const node = () => ({ connect: vi.fn((next: unknown) => next) });
  const context = {
    sampleRate: 8000,
    createGain: () => ({ ...node(), gain: param((value) => value > 0 && peaks.push(value)) }),
    createBiquadFilter: () => {
      const filter = { ...node(), type: "", Q: param(), frequency: { value: 0 } };
      queueMicrotask(() => bands.push(filter.frequency.value));
      return filter;
    },
    createBuffer: (_c: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => ({
      ...node(),
      buffer: null,
      playbackRate: { value: 1 },
      start: vi.fn(),
    }),
    createOscillator: () => {
      const glide: number[] = [];
      glides.push(glide);
      return {
        ...node(),
        type: "",
        frequency: {
          value: 0,
          setValueAtTime: vi.fn((value: number) => glide.push(value)),
          exponentialRampToValueAtTime: vi.fn((value: number) => glide.push(value)),
        },
        start: vi.fn(),
      };
    },
  };
  const voice: SynthVoiceContext = {
    context: context as unknown as AudioContext,
    output: node() as unknown as AudioNode,
    at: 2,
    volume: 1,
    rate: 1,
    random,
  };
  return { voice, peaks, bands, glides };
}

const pop = soundEffects.find(({ id }) => id === "block.dazzle_pop")!;
const config = (pop.source!.config as { config: PopConfig }).config;

describe("dazzle pop (#519)", () => {
  it("is a registered synthesised sound using the pop recipe, with a sample stand-in", () => {
    expect(pop.source?.provider).toBe("synth");
    expect(pop.placeholder).toBe("ui.click");
    expect(synthRecipes.has("pop")).toBe(true);
  });

  it("is a report over a thump that glides down from 1.6× its pitch, ending when both have", () => {
    const { voice, glides } = recordingVoice(() => 0.5);
    const made = synthRecipes.get("pop")(voice, config);
    expect(made.sources).toHaveLength(2);
    expect(glides[0]![0]).toBeCloseTo(config.thump[0] * 1.6);
    expect(glides[0]![1]).toBeCloseTo(config.thump[0]);
    expect(made.endsAt).toBeCloseTo(2 + Math.max(config.decay, config.thump[1]) + 0.03);
  });

  it("varies each voice a little, within its spread, so rapid pops never sound alike", async () => {
    const one = recordingVoice(() => 0);
    const two = recordingVoice(() => 1);
    synthRecipes.get("pop")(one.voice, config);
    synthRecipes.get("pop")(two.voice, config);
    await Promise.resolve();
    expect(one.bands[0]).not.toBe(two.bands[0]);
    for (const band of [...one.bands, ...two.bands]) {
      expect(band).toBeGreaterThanOrEqual(config.band * (1 - config.spread.band) - 1e-6);
      expect(band).toBeLessThanOrEqual(config.band * (1 + config.spread.band) + 1e-6);
    }
  });

  it("keeps headroom: no voice peaks above its level plus spread, so overlapping pops don't clip", () => {
    for (const roll of [0, 0.5, 1]) {
      const { voice, peaks } = recordingVoice(() => roll);
      synthRecipes.get("pop")(voice, config);
      for (const peak of peaks)
        expect(peak).toBeLessThanOrEqual(config.level * (1 + config.spread.level) + 1e-6);
    }
    expect(config.level * (1 + config.spread.level)).toBeLessThan(0.5);
  });
});
