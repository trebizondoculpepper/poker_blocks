// Plays registered sound effects by id. A sound with no generated audio yet is silent,
// so game code can call `playSfx` for every action before its audio exists.
import { sfxFileNames, soundEffects, type SoundEffectId } from "./sfx-registry";

const urlByFile = new Map(
  Object.entries(
    import.meta.glob<string>("../assets/sfx/*.mp3", {
      eager: true,
      query: "?url",
      import: "default",
    }),
  ).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1), url]),
);

const takesById = new Map(
  soundEffects.map((effect) => [
    effect.id,
    sfxFileNames(effect).flatMap((name) => urlByFile.get(name) ?? []),
  ]),
);

export type PlayOptions = {
  /** Playback-rate multiplier; above 1 raises the pitch. */
  rate?: number;
  /** Random pitch spread, e.g. 0.06 for ±6%. Default 0.04. */
  jitter?: number;
  /** 0 to 1, multiplied by the master volume. */
  volume?: number;
};

let masterVolume = 0.7;
let muted = false;

export function setSfxVolume(volume: number): void {
  masterVolume = Math.min(1, Math.max(0, volume));
}

export function setSfxMuted(value: boolean): void {
  muted = value;
}

/** Plays one take of a sound. Does nothing if the sound has no audio yet or is muted. */
export function playSfx(id: SoundEffectId, options: PlayOptions = {}): void {
  if (muted) return;
  const takes = takesById.get(id);
  if (!takes || takes.length === 0) return;
  const audio = new Audio(takes[Math.floor(Math.random() * takes.length)]);
  const jitter = options.jitter ?? 0.04;
  audio.preservesPitch = false;
  audio.playbackRate = (options.rate ?? 1) * (1 + (Math.random() * 2 - 1) * jitter);
  audio.volume = masterVolume * (options.volume ?? 1);
  // Browsers block audio until the first user gesture; a refused play is harmless.
  audio.play().catch(() => {});
}
