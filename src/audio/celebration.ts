/**
 * Celebrations (#494): a pop plus one to three party whistles, played together with slightly
 * different pitches and small start offsets, so several whistles sound a little discordant
 * rather than like one louder whistle. Played through the ordinary registered-sound path, so
 * mute and volume apply and nothing is synthesised. See doc/sound_design.md, "Celebrations".
 *
 * How many whistles is the material's to say (`celebration.whistles` on its definition); this
 * module never asks what is celebrating.
 */
import { playSfx, type PlayOptions } from "./sfx";
import type { SoundEffectId } from "./sfx-registry";

export type CelebrationConfig = {
  pop: SoundEffectId;
  whistle: SoundEffectId;
  /** 1 to 3. */
  whistles: number;
  /** Each whistle's pitch is spread across ±this (a playback-rate fraction). */
  pitchSpread: number;
  /** Each whistle starts up to this many seconds after the pop. */
  stagger: number;
};

export const defaultCelebration: CelebrationConfig = {
  pop: "celebration.pop",
  whistle: "celebration.whistle",
  whistles: 1,
  pitchSpread: 0.08,
  stagger: 0.12,
};

/** What a celebration needs to play: injectable so tests can watch it without audio. */
export type CelebrationPlayer = {
  play(id: SoundEffectId, options: PlayOptions): void;
  after(seconds: number, run: () => void): void;
  random(): number;
};

const browserPlayer: CelebrationPlayer = {
  play: playSfx,
  after: (seconds, run) => void setTimeout(run, seconds * 1000),
  random: () => Math.random(),
};

/** Play one celebration: the pop at once, then each whistle at its own pitch and offset. */
export function playCelebration(
  config: Partial<CelebrationConfig> = {},
  player: CelebrationPlayer = browserPlayer,
): void {
  const { pop, whistle, whistles, pitchSpread, stagger } = { ...defaultCelebration, ...config };
  const count = Math.max(1, Math.min(3, Math.round(whistles)));
  player.play(pop, {});
  for (let index = 0; index < count; index++) {
    // Pitches spread evenly across the range (a single whistle at the middle), nudged a little.
    const spread = count === 1 ? 0 : (index / (count - 1)) * 2 - 1;
    const rate = 1 + pitchSpread * (spread * 0.8 + (player.random() - 0.5) * 0.4);
    player.after(player.random() * stagger, () => player.play(whistle, { rate, jitter: 0 }));
  }
}

/** A material's celebration: its own whistle count, else one. */
export const celebrationOf = (definition: {
  celebration?: { whistles: number };
}): Partial<CelebrationConfig> => ({ whistles: definition.celebration?.whistles ?? 1 });
