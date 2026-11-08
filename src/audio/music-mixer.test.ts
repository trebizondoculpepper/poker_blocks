import { afterEach, expect, test, vi } from "vite-plus/test";
import { MusicMixer } from "./music-mixer";

class FakeParam {
  value = 1;
  setValueAtTime(value: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number): void {
    this.value = value;
  }
  setTargetAtTime(value: number): void {
    this.value = value;
  }
  cancelScheduledValues(): void {}
}

class FakeGain {
  gain = new FakeParam();
  connect(): this {
    return this;
  }
  disconnect(): void {}
}

class FakeSource {
  buffer: { duration: number } | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;
  started: [number, number] | null = null;
  stopped: number | null = null;
  connect(gain: FakeGain): FakeGain {
    return gain;
  }
  start(when: number, offset: number): void {
    this.started = [when, offset];
  }
  stop(when = 0): void {
    this.stopped = when;
  }
  disconnect(): void {}
}

class FakeContext {
  static last: FakeContext;
  currentTime = 0;
  destination = {};
  sources: FakeSource[] = [];
  constructor() {
    FakeContext.last = this;
  }
  createGain(): FakeGain {
    return new FakeGain();
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  async decodeAudioData(): Promise<{ duration: number }> {
    return { duration: 120 };
  }
  async resume(): Promise<void> {}
}

afterEach(() => vi.unstubAllGlobals());

test("both arrangements start together and a replacement joins the current playhead", async () => {
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
  const mixer = new MusicMixer({ a: "/a.ogg", b: "/b.ogg", c: "/c.ogg" }, ["a", "b"], 60);
  await mixer.play();

  const context = FakeContext.last;
  expect(context.sources[0].started).toEqual([0.08, 0]);
  expect(context.sources[1].started).toEqual([0.08, 0]);
  expect(context.sources[0].loopEnd).toBe(60);
  context.currentTime = 15;
  await mixer.select(1, "c", 2);
  expect(context.sources[2].started?.[0]).toBeCloseTo(15.08);
  expect(context.sources[2].started?.[1]).toBeCloseTo(15);
  expect(context.sources[1].stopped).toBeCloseTo(17.09);
});
