/** Two synchronized, looping music sources with an equal-power crossfade. */
export class MusicMixer {
  private readonly urls: Record<string, string>;
  private readonly context = new AudioContext();
  private readonly master = this.context.createGain();
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();
  private readonly slots: Array<{
    source: AudioBufferSourceNode;
    gain: GainNode;
    id: string;
  } | null> = [null, null];
  private readonly active = new Set<{
    source: AudioBufferSourceNode;
    gain: GainNode;
    id: string;
  }>();
  private readonly requests = [0, 0];
  private ids: [string, string];
  private blend = 0;
  private volume = 0.8;
  private loopSeconds: number;
  private startedAt = 0;
  private pausedAt = 0;
  private playing = false;

  constructor(urls: Record<string, string>, initial: [string, string], loopSeconds: number) {
    this.urls = urls;
    this.ids = initial;
    this.loopSeconds = loopSeconds;
    this.master.gain.value = this.volume;
    this.master.connect(this.context.destination);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get position(): number {
    const elapsed = this.playing ? this.context.currentTime - this.startedAt : this.pausedAt;
    if (elapsed < 0) return 0;
    return ((elapsed % this.loopSeconds) + this.loopSeconds) % this.loopSeconds;
  }

  private load(id: string): Promise<AudioBuffer> {
    let buffer = this.buffers.get(id);
    if (!buffer) {
      buffer = fetch(this.urls[id])
        .then((response) => {
          if (!response.ok) throw new Error(`Could not load ${id} (${response.status})`);
          return response.arrayBuffer();
        })
        .then((data) => this.context.decodeAudioData(data));
      this.buffers.set(id, buffer);
      buffer.catch(() => this.buffers.delete(id));
    }
    return buffer;
  }

  private level(slot: number): number {
    return slot === 0 ? Math.cos((this.blend * Math.PI) / 2) : Math.sin((this.blend * Math.PI) / 2);
  }

  private makeSource(slot: number, id: string, buffer: AudioBuffer, when: number, offset: number) {
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = this.loopSeconds;
    source.connect(gain).connect(this.master);
    source.start(when, offset);
    const entry = { source, gain, id };
    this.active.add(entry);
    source.onended = () => {
      this.active.delete(entry);
      source.disconnect();
      gain.disconnect();
    };
    this.slots[slot] = entry;
    return entry;
  }

  async play(): Promise<void> {
    if (this.playing) return;
    await this.context.resume();
    const [first, second] = await Promise.all(this.ids.map((id) => this.load(id)));
    if (Math.min(first.duration, second.duration) < this.loopSeconds) {
      throw new Error("The shared loop is longer than one of the selected recordings.");
    }
    const when = this.context.currentTime + 0.08;
    const offset = this.pausedAt % this.loopSeconds;
    this.startedAt = when - offset;
    this.makeSource(0, this.ids[0], first, when, offset).gain.gain.value = this.level(0);
    this.makeSource(1, this.ids[1], second, when, offset).gain.gain.value = this.level(1);
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedAt = this.position;
    this.playing = false;
    for (const slot of [0, 1]) this.requests[slot]++;
    for (const entry of this.active) entry.source.stop();
    this.slots[0] = null;
    this.slots[1] = null;
  }

  async select(slot: 0 | 1, id: string, fadeSeconds: number): Promise<void> {
    if (id === this.ids[slot]) return;
    const request = ++this.requests[slot];
    const buffer = await this.load(id);
    if (request !== this.requests[slot]) return;
    if (buffer.duration < this.loopSeconds) throw new Error(`${id} is shorter than the loop.`);
    this.ids[slot] = id;
    if (!this.playing) return;
    const when = this.context.currentTime + 0.08;
    const offset =
      (((when - this.startedAt) % this.loopSeconds) + this.loopSeconds) % this.loopSeconds;
    const old = this.slots[slot];
    const next = this.makeSource(slot, id, buffer, when, offset);
    const level = this.level(slot);
    next.gain.gain.setValueAtTime(0, when);
    next.gain.gain.linearRampToValueAtTime(level, when + fadeSeconds);
    if (old) {
      old.gain.gain.cancelScheduledValues(when);
      old.gain.gain.setValueAtTime(old.gain.gain.value, when);
      old.gain.gain.linearRampToValueAtTime(0, when + fadeSeconds);
      old.source.stop(when + fadeSeconds + 0.01);
    }
  }

  setBlend(value: number, seconds = 0.04): void {
    this.blend = Math.max(0, Math.min(1, value));
    for (const slot of [0, 1]) {
      const gain = this.slots[slot]?.gain.gain;
      if (!gain) continue;
      const now = this.context.currentTime;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(this.level(slot), now + seconds);
    }
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.02);
  }

  async seek(position: number): Promise<void> {
    this.pause();
    this.pausedAt = Math.max(0, Math.min(this.loopSeconds - 0.01, position));
    await this.play();
  }

  async setLoopSeconds(seconds: number): Promise<void> {
    const wasPlaying = this.playing;
    this.pause();
    this.loopSeconds = seconds;
    this.pausedAt %= seconds;
    if (wasPlaying) await this.play();
  }
}
