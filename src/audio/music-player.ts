/**
 * Game music: seamless loops from music/loops/, switched on the bar like the music room.
 *
 * Switching from A to B: on the next bar line B enters on the same beat, playing at A's
 * tempo; the two crossfade over two bars (square-law by default); A stops when B is fully up; then,
 * after an optional delay, the tempo eases to B's natural speed like a tape machine.
 * All loops follow one beat clock, so beats stay locked throughout.
 */
import { sharedAudioContext } from "./audio-context";
import { createBeatClock, type BeatClock } from "./beat-clock";
import { fadeCurve, type FadeKind } from "./music-fade";
import { defaultWind, holdAt, scheduleWindDown, standstill, type WindShape } from "./music-wind";

export type LoopInfo = {
  tempo_bpm: number;
  beats: number;
  loop_seconds: number;
  /** Where beat 1 of a bar falls in the loop. */
  first_beat_seconds?: number;
  /** Beats in a bar; 4 when absent. */
  beats_per_bar?: number;
};

/**
 * Where the heard music is (#255): its beat position from the shared beat clock, the current
 * bar length and the tempo. Computed from each loop's registered tempo and beat offset; nothing
 * analyses audio.
 */
export type MusicPosition = { beat: number; beatsPerBar: number; tempo: number };

export type MusicTrack = { id: string; url: string; info: LoopInfo };

export type SwitchOptions = {
  /** Crossfade length in bars (4 beats each) at the outgoing tempo. */
  fadeBars: number;
  fadeKind: FadeKind;
  /** Hold the outgoing tempo this long after the fade before easing. */
  easeDelaySeconds: number;
  easeSeconds: number;
};

export const defaultSwitch: SwitchOptions = {
  fadeBars: 2,
  fadeKind: "exponential",
  easeDelaySeconds: 0,
  easeSeconds: 5,
};

type Voice = { track: MusicTrack; source: AudioBufferSourceNode; gain: GainNode };

export type MusicPlayer = {
  readonly current: string | null;
  play(id: string, options?: Partial<SwitchOptions>): Promise<void>;
  stop(fadeSeconds?: number): void;
  /** Cut the power, as on a record player: everything slows to a stop over `seconds`. */
  windDown(seconds?: number, shape?: WindShape): void;
  /** Start a loop from a standstill, speeding up to its tempo over `seconds` like a platter. */
  windUp(id: string, seconds?: number): Promise<void>;
  setVolume(volume: number): void;
  /**
   * Muffle the music through a low-pass filter, easing its cut-off down to `hz` over
   * `seconds` (as if heard from another room). clearLowPass eases it back open.
   */
  setLowPass(hz: number, seconds?: number): void;
  clearLowPass(seconds?: number): void;
  /**
   * Thin the music through a high-pass filter, easing its cut-off up to `hz` over `seconds`
   * (the Settings sound, distinct from the pause menu's low-pass). clearHighPass eases it off.
   */
  setHighPass(hz: number, seconds?: number): void;
  clearHighPass(seconds?: number): void;
  setMuted(muted: boolean): void;
  /** Call from a user gesture: browsers keep audio suspended until one happens. */
  unlock(): void;
  /**
   * Where the music being heard is at `performanceNow` (a `performance.now()` time), or null
   * when nothing is playing. Muted music still has a position: its clock keeps running.
   */
  position(performanceNow: number): MusicPosition | null;
};

/** A low-pass cut-off high enough to leave the music untouched. */
const openCutoff = 20000;
/** A high-pass cut-off low enough to leave the music untouched. */
const openHighCutoff = 10;

/** Ease a filter's cut-off to `hz` over `seconds`; exponential, even steps to the ear. */
function sweep(context: AudioContext, filter: BiquadFilterNode, hz: number, seconds: number): void {
  const now = context.currentTime;
  const frequency = filter.frequency;
  frequency.cancelScheduledValues(now);
  frequency.setValueAtTime(frequency.value, now);
  frequency.exponentialRampToValueAtTime(hz, now + Math.max(0.01, seconds));
}

/** A track's bar length in beats. */
export const beatsPerBar = (info: LoopInfo): number => info.beats_per_bar ?? 4;

/**
 * The audio-clock time being heard at `performanceNow`: through the context's paired output
 * timestamp where the browser gives one, otherwise the current time less the output latency.
 */
export function heardTime(context: AudioContext, performanceNow: number): number {
  const stamp = context.getOutputTimestamp?.();
  if (stamp?.contextTime && stamp.performanceTime)
    return stamp.contextTime + (performanceNow - stamp.performanceTime) / 1000;
  return context.currentTime - (context.outputLatency || context.baseLatency || 0);
}

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
  /** Low-pass on the output: wide open (inaudible) unless the music is muffled. */
  let filter: BiquadFilterNode | null = null;
  /** The cut-off asked for, kept so a filter made later (on unlock) starts there. */
  let cutoff = openCutoff;
  /** High-pass after the low-pass: wide open unless Settings thins the music. */
  let highFilter: BiquadFilterNode | null = null;
  let highCutoff = openHighCutoff;
  let volume = 0.6;
  let muted = false;
  const buffers = new Map<string, Promise<AudioBuffer>>();
  let current: Voice | null = null;
  const fading = new Set<Voice>();
  let clock: BeatClock | null = null;
  let token = 0;

  function audio(): { context: AudioContext; master: GainNode } {
    if (!context || !master) {
      // The game's one shared context (#518), so sound effects and music share it.
      context = sharedAudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : volume;
      filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 0.7;
      filter.frequency.value = cutoff;
      highFilter = context.createBiquadFilter();
      highFilter.type = "highpass";
      highFilter.Q.value = 0.7;
      highFilter.frequency.value = highCutoff;
      master.connect(filter).connect(highFilter).connect(context.destination);
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

  /** Seconds that `bars` bars of `track` last at `tempo` BPM. */
  const barsToSeconds = (bars: number, tempo: number, track: MusicTrack) =>
    (bars * beatsPerBar(track.info) * 60) / tempo;

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
          barsToSeconds(options.fadeBars, track.info.tempo_bpm, track),
        );
        return;
      }

      // Fades start on the next bar line, with B entering on the same beat at A's tempo.
      const now = context.currentTime + 0.05;
      const bar = beatsPerBar(current.track.info);
      const at = clock.timeOfBeat(Math.ceil(clock.beatAt(now) / bar) * bar);
      const from = clock.tempoAt(at);
      const to = track.info.tempo_bpm;
      const beat = clock.beatAt(at);
      // The tempo holds at `from` through the fade, so its bars are a fixed length.
      const fadeSeconds = barsToSeconds(options.fadeBars, from, current.track);
      clock.ramp(at, 0, from);
      const easeAt = at + fadeSeconds + options.easeDelaySeconds;
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
      outgoing.gain.gain.setValueCurveAtTime(fadeCurve(options.fadeKind, false), at, fadeSeconds);
      incoming.gain.gain.setValueCurveAtTime(fadeCurve(options.fadeKind, true), at, fadeSeconds);
      retire(outgoing, at + fadeSeconds);
      current = incoming;
    },

    stop(fadeSeconds = 1.5) {
      token++;
      if (!context || !current) return;
      const now = context.currentTime;
      holdAt(current.gain.gain, now);
      current.gain.gain.linearRampToValueAtTime(0, now + fadeSeconds);
      retire(current, now + fadeSeconds);
      current = null;
      clock = null;
    },

    async windUp(id, seconds = defaultWind.upSeconds) {
      const track = byId.get(id);
      if (!track) return;
      // Anything still sounding stops now; the new loop starts from rest.
      this.stop(0.05);
      const mine = ++token;
      const buffer = await load(track);
      if (mine !== token) return;
      const { context } = audio();
      const at = context.currentTime + 0.05;
      const tempo = track.info.tempo_bpm;
      // The beat clock eases up with the audio, so later switches stay on the beat.
      clock = createBeatClock(at, tempo * standstill);
      clock.ramp(at, seconds, tempo);
      current = startVoice(track, buffer, at, 0, tempo * standstill);
      current.source.playbackRate.setValueCurveAtTime(
        rateCurve(at, seconds, tempo),
        at + 0.001,
        seconds,
      );
      current.source.playbackRate.setValueAtTime(1, at + seconds + 0.01);
      // Sound comes in quickly as the platter starts to turn.
      current.gain.gain.setValueCurveAtTime(fadeCurve("s-curve", true), at, Math.min(0.6, seconds));
    },

    windDown(seconds = defaultWind.downSeconds, shape = defaultWind) {
      token++;
      if (!context) return;
      const now = context.currentTime;
      for (const voice of [...(current ? [current] : []), ...fading]) {
        scheduleWindDown(voice.source, voice.gain, now, { ...shape, downSeconds: seconds });
        fading.add(voice);
        voice.source.addEventListener("ended", () => fading.delete(voice));
      }
      current = null;
      clock = null;
    },

    setLowPass(hz, seconds = 2) {
      cutoff = Math.max(40, Math.min(openCutoff, hz));
      if (!context || !filter) return;
      sweep(context, filter, cutoff, seconds);
    },

    clearLowPass(seconds = 2) {
      this.setLowPass(openCutoff, seconds);
    },

    setHighPass(hz, seconds = 2) {
      highCutoff = Math.max(openHighCutoff, Math.min(openCutoff, hz));
      if (!context || !highFilter) return;
      sweep(context, highFilter, highCutoff, seconds);
    },

    clearHighPass(seconds = 2) {
      this.setHighPass(openHighCutoff, seconds);
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

    position(performanceNow) {
      if (!context || !clock || !current || context.state !== "running") return null;
      const heard = heardTime(context, performanceNow);
      return {
        beat: clock.beatAt(heard),
        beatsPerBar: beatsPerBar(current.track.info),
        tempo: clock.tempoAt(heard),
      };
    },
  };
}
