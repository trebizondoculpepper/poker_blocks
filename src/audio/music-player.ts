/**
 * Game music: seamless loops from music/loops/, switched on the bar like the music room.
 *
 * Switching from A to B: on the next bar line B enters on the same beat, playing at A's
 * tempo; the two crossfade (logarithmic by default); A stops when B is fully up; then,
 * after an optional delay, the tempo eases to B's natural speed like a tape machine.
 * All loops follow one beat clock, so beats stay locked throughout.
 */
import { createBeatClock, type BeatClock } from "./beat-clock";
import { fadeCurve, type FadeKind } from "./music-fade";

export type LoopInfo = {
  tempo_bpm: number;
  beats: number;
  loop_seconds: number;
  /** Where beat 1 of a bar falls in the loop. */
  first_beat_seconds?: number;
};

export type MusicTrack = { id: string; url: string; info: LoopInfo };

export type SwitchOptions = {
  fadeSeconds: number;
  fadeKind: FadeKind;
  /** Hold the outgoing tempo this long after the fade before easing. */
  easeDelaySeconds: number;
  easeSeconds: number;
};

export const defaultSwitch: SwitchOptions = {
  fadeSeconds: 4,
  fadeKind: "logarithmic",
  easeDelaySeconds: 0,
  easeSeconds: 5,
};

type Voice = { track: MusicTrack; source: AudioBufferSourceNode; gain: GainNode };

export type MusicPlayer = {
  readonly current: string | null;
  play(id: string, options?: Partial<SwitchOptions>): Promise<void>;
  stop(fadeSeconds?: number): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** Call from a user gesture: browsers keep audio suspended until one happens. */
  unlock(): void;
};

/** Seconds into a loop for a shared beat position (beat 0 is the first downbeat). */
export function loopOffset(info: LoopInfo, beat: number): number {
  const { beats, loop_seconds, first_beat_seconds = 0 } = info;
  const within = ((beat % beats) + beats) % beats;
  return (first_beat_seconds + (within / beats) * loop_seconds) % loop_seconds;
}

export function createMusicPlayer(tracks: readonly MusicTrack[]): MusicPlayer {
  const byId = new Map(tracks.map((track) => [track.id, track]));
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let volume = 0.6;
  let muted = false;
  const buffers = new Map<string, Promise<AudioBuffer>>();
  let current: Voice | null = null;
  const fading = new Set<Voice>();
  let clock: BeatClock | null = null;
  let token = 0;

  function audio(): { context: AudioContext; master: GainNode } {
    if (!context || !master) {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(context.destination);
    }
    return { context, master };
  }

  function load(track: MusicTrack): Promise<AudioBuffer> {
    let pending = buffers.get(track.id);
    if (!pending) {
      pending = fetch(track.url)
        .then((response) => response.arrayBuffer())
        .then((data) => audio().context.decodeAudioData(data));
      buffers.set(track.id, pending);
    }
    return pending;
  }

  function startVoice(
    track: MusicTrack,
    buffer: AudioBuffer,
    at: number,
    beat: number,
    tempo: number,
  ): Voice {
    const { context, master } = audio();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = track.info.loop_seconds;
    source.playbackRate.setValueAtTime(tempo / track.info.tempo_bpm, at);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, at);
    source.connect(gain).connect(master);
    source.start(at, loopOffset(track.info, beat));
    return { track, source, gain };
  }

  function retire(voice: Voice, at: number): void {
    voice.source.stop(at);
    fading.add(voice);
    voice.source.addEventListener("ended", () => fading.delete(voice));
  }

  function rateCurve(start: number, seconds: number, tempo: number): Float32Array {
    const curve = new Float32Array(128);
    for (let i = 0; i < curve.length; i++) {
      curve[i] = clock!.tempoAt(start + (seconds * i) / (curve.length - 1)) / tempo;
    }
    return curve;
  }

  return {
    get current() {
      return current?.track.id ?? null;
    },

    async play(id, overrides = {}) {
      const options = { ...defaultSwitch, ...overrides };
      const track = byId.get(id);
      if (!track || current?.track === track) return;
      const mine = ++token;
      const buffer = await load(track);
      if (mine !== token) return;
      const { context } = audio();

      if (!current || !clock) {
        const at = context.currentTime + 0.05;
        clock = createBeatClock(at, track.info.tempo_bpm);
        current = startVoice(track, buffer, at, 0, track.info.tempo_bpm);
        current.gain.gain.setValueCurveAtTime(
          fadeCurve(options.fadeKind, true),
          at,
          options.fadeSeconds,
        );
        return;
      }

      // Fades start on the next bar line, with B entering on the same beat at A's tempo.
      const now = context.currentTime + 0.05;
      const at = clock.timeOfBeat(Math.ceil(clock.beatAt(now) / 4) * 4);
      const from = clock.tempoAt(at);
      const to = track.info.tempo_bpm;
      const beat = clock.beatAt(at);
      clock.ramp(at, 0, from);
      const easeAt = at + options.fadeSeconds + options.easeDelaySeconds;
      clock.ramp(easeAt, options.easeSeconds, to);

      const outgoing = current;
      const incoming = startVoice(track, buffer, at, beat, from);
      outgoing.source.playbackRate.cancelScheduledValues(at);
      outgoing.source.playbackRate.setValueAtTime(from / outgoing.track.info.tempo_bpm, at);
      if (options.easeSeconds > 0) {
        incoming.source.playbackRate.setValueCurveAtTime(
          rateCurve(easeAt, options.easeSeconds, to),
          easeAt,
          options.easeSeconds,
        );
      }
      incoming.source.playbackRate.setValueAtTime(1, easeAt + options.easeSeconds);
      outgoing.gain.gain.cancelScheduledValues(at);
      outgoing.gain.gain.setValueCurveAtTime(
        fadeCurve(options.fadeKind, false),
        at,
        options.fadeSeconds,
      );
      incoming.gain.gain.setValueCurveAtTime(
        fadeCurve(options.fadeKind, true),
        at,
        options.fadeSeconds,
      );
      retire(outgoing, at + options.fadeSeconds);
      current = incoming;
    },

    stop(fadeSeconds = 1.5) {
      token++;
      if (!context || !current) return;
      const now = context.currentTime;
      current.gain.gain.cancelScheduledValues(now);
      current.gain.gain.setValueAtTime(current.gain.gain.value, now);
      current.gain.gain.linearRampToValueAtTime(0, now + fadeSeconds);
      retire(current, now + fadeSeconds);
      current = null;
      clock = null;
    },

    setVolume(next) {
      volume = Math.min(1, Math.max(0, next));
      if (context && master && !muted)
        master.gain.setTargetAtTime(volume, context.currentTime, 0.05);
    },

    setMuted(next) {
      muted = next;
      if (context && master)
        master.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, 0.05);
    },

    unlock() {
      const { context } = audio();
      if (context.state === "suspended") void context.resume();
    },
  };
}
