// Development page for auditioning theme loops and beat-matched crossfades. Served at
// /music.html. It lists every `*-loop.ogg` in music/loops/ with the tempo and beat count
// from its sidecar. Clicking a loop fades it in on the next bar.
import "./style.css";
import { createBeatClock } from "../audio/beat-clock";
import { fadeCurve, fadeKinds, type FadeKind } from "../audio/music-fade";
import { fitTaps, snapToLoop, type LoopTempo } from "./tap-tempo";

type LoopInfo = {
  tempo_bpm: number;
  beats: number;
  loop_seconds: number;
  /** Where beat 1 of a bar falls in the loop; 0 when the loop starts on a downbeat. */
  first_beat_seconds?: number;
  source?: string;
};
type Track = {
  id: string;
  file: string;
  group: string;
  name: string;
  url: string;
  info: LoopInfo;
};

const audioUrls = import.meta.glob<string>("../../music/loops/*-loop.ogg", {
  eager: true,
  query: "?url",
  import: "default",
});
const infos = import.meta.glob<LoopInfo>("../../music/loops/*-loop.json", {
  eager: true,
  import: "default",
});

/** Tempos tapped in this room, kept in the browser until saved into the project. */
const overridesKey = "music-room.tapped-tempos";
function loadOverrides(): Record<string, LoopTempo> {
  try {
    return JSON.parse(localStorage.getItem(overridesKey) ?? "{}") as Record<string, LoopTempo>;
  } catch {
    return {};
  }
}
const overrides = loadOverrides();

const tracks: Track[] = Object.entries(audioUrls)
  .map(([path, url]) => {
    const info = infos[path.replace(/\.ogg$/, ".json")];
    const parts = path.split("/");
    const file = parts.at(-1)!.replace(/-loop\.ogg$/, "");
    // Group by prefix: "style-noir" -> Styles, "solitaire-boss" -> Solitaire, else Theme.
    const prefix = file.split("-")[0];
    const group = prefix === "style" ? "Styles" : prefix === "solitaire" ? "Solitaire" : "Theme";
    const name = group === "Theme" ? file : file.slice(prefix.length + 1);
    const tapped = overrides[file];
    return { id: path, file, group, name, url, info: tapped ? { ...info, ...tapped } : info };
  })
  // Only loops measured with a whole number of beats can be beat-matched.
  .filter((track) => track.info && Number.isInteger(track.info.beats))
  .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

const volume = element<HTMLInputElement>("volume");
const fade = element<HTMLInputElement>("fade");
const fadeValue = element<HTMLOutputElement>("fade-value");
const ease = element<HTMLInputElement>("ease");
const easeDelay = element<HTMLInputElement>("ease-delay");
const delayValue = element<HTMLOutputElement>("delay-value");
const fadeShape = element<HTMLSelectElement>("fade-shape");
for (const [kind, label] of Object.entries(fadeKinds)) fadeShape.add(new Option(label, kind));
fadeShape.value = "exponential";
const fadeKind = (): FadeKind => fadeShape.value as FadeKind;
/** The crossfade length in seconds: the slider counts bars (4 beats) at `tempo` BPM. */
const fadeSeconds = (tempo: number): number => (Number(fade.value) * 4 * 60) / tempo;
const easeValue = element<HTMLOutputElement>("ease-value");
const click = element<HTMLInputElement>("click");
const status = element<HTMLParagraphElement>("status");
const beatLights = [...element<HTMLDivElement>("beat").children] as HTMLElement[];

let context: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();

function audio(): { context: AudioContext; master: GainNode } {
  if (!context || !master) {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = Number(volume.value);
    master.connect(context.destination);
  }
  return { context, master };
}

function load(track: Track): Promise<AudioBuffer> {
  let pending = buffers.get(track.id);
  if (!pending) {
    pending = fetch(track.url)
      .then((response) => response.arrayBuffer())
      .then((data) => audio().context.decodeAudioData(data));
    buffers.set(track.id, pending);
  }
  return pending;
}

/** A track that is sounding: its source follows the shared tempo through its rate. */
type Voice = { track: Track; source: AudioBufferSourceNode; gain: GainNode };
let current: Voice | null = null;
const fading = new Set<Voice>();
let clock: ReturnType<typeof createBeatClock> | null = null;
let switchToken = 0;

/** Seconds into a loop for a shared beat position (beat 0 is the loop's first downbeat). */
function offsetFor(track: Track, beat: number): number {
  const { beats, loop_seconds, first_beat_seconds = 0 } = track.info;
  const within = ((beat % beats) + beats) % beats;
  return (first_beat_seconds + (within / beats) * loop_seconds) % loop_seconds;
}

function startVoice(
  track: Track,
  buffer: AudioBuffer,
  at: number,
  beat: number,
  tempo: number,
): Voice {
  const { context, master } = audio();
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  // Loop exactly the whole-beat span recorded for this track.
  source.loopStart = 0;
  source.loopEnd = track.info.loop_seconds;
  source.playbackRate.setValueAtTime(tempo / track.info.tempo_bpm, at);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, at);
  source.connect(gain).connect(master);
  source.start(at, offsetFor(track, beat));
  return { track, source, gain };
}

/** Playback rate over an eased tempo change, sampled from the beat clock. */
function rateCurve(
  beatClock: ReturnType<typeof createBeatClock>,
  start: number,
  seconds: number,
  tempo: number,
): Float32Array {
  const steps = 128;
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    curve[i] = beatClock.tempoAt(start + (seconds * i) / (steps - 1)) / tempo;
  }
  return curve;
}

async function select(track: Track): Promise<void> {
  const token = ++switchToken;
  const buffer = await load(track);
  if (token !== switchToken) return;
  const { context } = audio();
  if (context.state === "suspended") await context.resume();
  // Switching always happens at full speed.
  if (half.checked) {
    setHalfSpeed(false);
    half.checked = false;
  }

  if (!current || !clock) {
    const at = context.currentTime + 0.05;
    clock = createBeatClock(at, track.info.tempo_bpm);
    current = startVoice(track, buffer, at, 0, track.info.tempo_bpm);
    // The first loop fades in too, over the same curve and number of bars.
    current.gain.gain.setValueCurveAtTime(
      fadeCurve(fadeKind(), true),
      at,
      fadeSeconds(track.info.tempo_bpm),
    );
    render();
    return;
  }
  if (current.track === track) return;

  const now = context.currentTime + 0.05;
  // Fades always start on the next bar line, with the incoming loop entering on the same beat.
  const at = clock.timeOfBeat(Math.ceil(clock.beatAt(now) / 4) * 4);
  const easeSeconds = Number(ease.value);
  const from = clock.tempoAt(at);
  // A's tempo holds through the fade, so its bars are a fixed length.
  const seconds = fadeSeconds(from);
  const to = track.info.tempo_bpm;
  const beat = clock.beatAt(at);
  // 1. Hold A's tempo through the crossfade; B plays at A's speed, beats matched.
  clock.ramp(at, 0, from);
  // 2. After the fade, and an optional delay at A's tempo, ease B to its natural tempo.
  const easeAt = at + seconds + Number(easeDelay.value);
  clock.ramp(easeAt, easeSeconds, to);

  const outgoing = current;
  const incoming = startVoice(track, buffer, at, beat, from);
  outgoing.source.playbackRate.cancelScheduledValues(at);
  outgoing.source.playbackRate.setValueAtTime(from / outgoing.track.info.tempo_bpm, at);
  incoming.source.playbackRate.setValueAtTime(from / to, easeAt);
  if (easeSeconds > 0) {
    incoming.source.playbackRate.setValueCurveAtTime(
      rateCurve(clock, easeAt, easeSeconds, to),
      easeAt,
      easeSeconds,
    );
  }
  incoming.source.playbackRate.setValueAtTime(1, easeAt + easeSeconds);
  outgoing.gain.gain.cancelScheduledValues(at);
  outgoing.gain.gain.setValueCurveAtTime(fadeCurve(fadeKind(), false), at, seconds);
  incoming.gain.gain.setValueCurveAtTime(fadeCurve(fadeKind(), true), at, seconds);
  // A stops as soon as B is fully faded up.
  outgoing.source.stop(at + seconds);
  fading.add(outgoing);
  outgoing.source.addEventListener("ended", () => fading.delete(outgoing));
  current = incoming;
  render();
}

function stop(): void {
  switchToken++;
  half.checked = false;
  for (const voice of [current, ...fading]) voice?.source.stop();
  fading.clear();
  current = null;
  clock = null;
  render();
}

let lastClickBeat = -1;
function tick(): void {
  if (context && clock && current) {
    const now = context.currentTime;
    const beat = clock.beatAt(now);
    const whole = Math.floor(beat);
    beatLights.forEach((light, index) =>
      light.classList.toggle("on", ((whole % 4) + 4) % 4 === index),
    );
    status.textContent = `Playing ${current.track.name} · ${clock.tempoAt(now).toFixed(1)} BPM · bar ${
      Math.floor(beat / 4) + 1
    }, beat ${(((whole % 4) + 4) % 4) + 1}`;
    if (click.checked && whole !== lastClickBeat && whole >= 0)
      playClick(clock.timeOfBeat(whole + 1), (whole + 1) % 4 === 0);
    lastClickBeat = whole;
  } else {
    beatLights.forEach((light) => light.classList.remove("on"));
    status.textContent = "Stopped.";
  }
  requestAnimationFrame(tick);
}

/** A short click on the next beat, accented on the downbeat, to check alignment by ear. */
function playClick(at: number, downbeat: boolean): void {
  const { context, master } = audio();
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.frequency.value = downbeat ? 1800 : 1200;
  gain.gain.setValueAtTime(0.4, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + 0.05);
}

function render(): void {
  document.querySelectorAll<HTMLButtonElement>(".track").forEach((button) => {
    button.classList.toggle("playing", button.dataset.id === current?.track.id);
  });
}

function trackSummary(track: Track): string {
  const { tempo_bpm, beats, loop_seconds } = track.info;
  const length = `${Math.floor(loop_seconds / 60)}:${String(Math.round(loop_seconds % 60)).padStart(2, "0")}`;
  return `${tempo_bpm.toFixed(1)} BPM · ${beats / 4} bars · ${length}${overrides[track.file] ? " · tapped" : ""}`;
}

const groups = element<HTMLElement>("groups");
for (const group of new Set(tracks.map((track) => track.group))) {
  const section = document.createElement("section");
  section.className = "group";
  section.innerHTML = `<h2>${group}</h2>`;
  const list = document.createElement("div");
  list.className = "tracks";
  for (const track of tracks.filter((item) => item.group === group)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "track";
    button.dataset.id = track.id;
    button.innerHTML = `<strong>${track.name}</strong><span>${trackSummary(track)}</span>`;
    button.addEventListener("click", () => void select(track));
    list.append(button);
  }
  section.append(list);
  groups.append(section);
}
if (tracks.length === 0) groups.textContent = "No measured loops found under music/.";

// ----- Tap tempo -----
const tapButton = element<HTMLButtonElement>("tap");
const half = element<HTMLInputElement>("half");
const tapReadout = element<HTMLParagraphElement>("tap-readout");
const tapApply = element<HTMLButtonElement>("tap-apply");
const overridesOut = element<HTMLTextAreaElement>("overrides");
let taps: number[] = [];
let tapTrack: Track | null = null;
let estimate: LoopTempo | null = null;

/** Unwrapped position in the loop's own audio at a time, from the shared beat clock. */
function audioPosition(track: Track, time: number): number {
  const { beats, loop_seconds, first_beat_seconds = 0 } = track.info;
  return first_beat_seconds + (clock!.beatAt(time) * loop_seconds) / beats;
}

function resetTaps(): void {
  taps = [];
  estimate = null;
  tapApply.disabled = true;
  tapReadout.textContent = current
    ? `Tap along to ${current.track.name}.`
    : "Start a loop, then tap.";
}

function tap(): void {
  if (!context || !clock || !current) return;
  if (tapTrack !== current.track) {
    tapTrack = current.track;
    resetTaps();
  }
  // The sound heard now left the speakers' buffer outputLatency ago.
  const heard = context.currentTime - (context.outputLatency || 0);
  taps.push(audioPosition(current.track, heard));
  const fit = fitTaps(taps);
  if (!fit) {
    tapReadout.textContent = `${taps.length} taps… keep going.`;
    return;
  }
  estimate = snapToLoop(fit.bpm, current.track.info.loop_seconds, taps[0]);
  tapApply.disabled = taps.length < 8;
  tapReadout.textContent =
    `${taps.length} taps: ${fit.bpm.toFixed(1)} BPM (±${Math.round(fit.jitter * 1000)} ms), ` +
    `snapped to ${estimate.tempo_bpm.toFixed(2)} BPM, ${estimate.beats / 4} bars; ` +
    `currently ${current.track.info.tempo_bpm.toFixed(2)} BPM.` +
    (taps.length < 8 ? " Tap at least 8 times to use it." : "");
}

function showOverrides(): void {
  overridesOut.value = Object.keys(overrides).length ? JSON.stringify(overrides, null, 2) : "";
}

/** Apply the tapped tempo to the playing loop without interrupting its audio. */
function applyEstimate(): void {
  if (!context || !clock || !current || !estimate) return;
  const track = current.track;
  const now = context.currentTime;
  const position = audioPosition(track, now);
  const speed = half.checked ? 0.5 : 1;
  track.info = { ...track.info, ...estimate };
  overrides[track.file] = estimate;
  try {
    localStorage.setItem(overridesKey, JSON.stringify(overrides));
  } catch {
    // The override still applies for this visit.
  }
  // Re-anchor the clock so the audio keeps its place under the new beat grid.
  const { beats, loop_seconds, first_beat_seconds = 0, tempo_bpm } = track.info;
  clock.rebase(now, ((position - first_beat_seconds) * beats) / loop_seconds, tempo_bpm * speed);
  current.source.playbackRate.cancelScheduledValues(now);
  current.source.playbackRate.setValueAtTime(speed, now);
  relabel(track);
  showOverrides();
  resetTaps();
  tapReadout.textContent = `Now using ${tempo_bpm.toFixed(2)} BPM for ${track.name}.`;
}

/** Half speed: halve the shared clock's tempo, so taps and beats stay consistent. */
function setHalfSpeed(on: boolean): void {
  if (!context || !clock || !current) return;
  const now = context.currentTime;
  const tempo = clock.tempoAt(now) * (on ? 0.5 : 2);
  clock.rebase(now, clock.beatAt(now), tempo);
  current.source.playbackRate.cancelScheduledValues(now);
  current.source.playbackRate.setValueAtTime(tempo / current.track.info.tempo_bpm, now);
}

function relabel(track: Track): void {
  const label = document.querySelector<HTMLElement>(
    `.track[data-id="${CSS.escape(track.id)}"] span`,
  );
  if (label) label.textContent = trackSummary(track);
}

tapButton.addEventListener("click", tap);
window.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.repeat) return;
  event.preventDefault();
  tap();
});
element<HTMLButtonElement>("tap-reset").addEventListener("click", resetTaps);
tapApply.addEventListener("click", applyEstimate);
half.addEventListener("change", () => setHalfSpeed(half.checked));
element<HTMLButtonElement>("overrides-clear").addEventListener("click", () => {
  for (const key of Object.keys(overrides)) delete overrides[key];
  try {
    localStorage.removeItem(overridesKey);
  } catch {
    // Nothing stored.
  }
  showOverrides();
  tapReadout.textContent = "Tapped tempos forgotten; reload to use the project's values.";
});
showOverrides();

element<HTMLButtonElement>("stop").addEventListener("click", stop);
volume.addEventListener("input", () =>
  master?.gain.setTargetAtTime(Number(volume.value), audio().context.currentTime, 0.05),
);
const barsLabel = () => `${fade.value} ${fade.value === "1" ? "bar" : "bars"}`;
fade.addEventListener("input", () => (fadeValue.textContent = barsLabel()));
ease.addEventListener("input", () => (easeValue.textContent = `${ease.value} s`));
easeDelay.addEventListener("input", () => (delayValue.textContent = `${easeDelay.value} s`));
requestAnimationFrame(tick);
