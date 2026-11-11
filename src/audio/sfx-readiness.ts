/**
 * Whether the game can hear a registered sound, and how (#522), for the listening room and
 * tooling: a registry keyed by the sound's provider (src/audio/sfx-providers.ts), so nothing asks
 * which sound it is or branches on where its audio comes from.
 *
 * - `sample`: its own pre-generated takes, else its placeholder's (`stand-in`), else `silent`.
 * - `synth`: ready (`own`) when its recipe is registered, whatever MP3s exist; else its placeholder
 *   stands in, else silent. A synthesised sound is never "missing" just for having no file.
 *
 * `repeatable` marks sources worth auditioning in rapid repeats (their voices vary).
 */
import { Registry } from "../core/registry";
import type { SoundEffect } from "./sfx-registry";
import { synthRecipes } from "./synth";

export type Readiness = {
  /** `own`: its own audio; `stand-in`: its placeholder's; `silent`: nothing plays. */
  status: "own" | "stand-in" | "silent";
  /** A short description of where its audio comes from, for display. */
  source: string;
  /** Whether rapid repeated audition is useful for it (each voice varies). */
  repeatable: boolean;
};

/** How many takes a sound has, its own and its placeholder's: the sample files that exist. */
export type TakeCounts = { own: number; placeholder: number };

export const sfxReadiness = new Registry<(effect: SoundEffect, takes: TakeCounts) => Readiness>(
  "sound readiness",
);

const fallBack = (effect: SoundEffect, takes: TakeCounts, source: string): Readiness => ({
  status: takes.placeholder > 0 && effect.placeholder ? "stand-in" : "silent",
  source,
  repeatable: false,
});

sfxReadiness.register("sample", (effect, takes) =>
  takes.own > 0
    ? { status: "own", source: "sample", repeatable: false }
    : fallBack(effect, takes, "sample"),
);

sfxReadiness.register("synth", (effect, takes) => {
  const recipe = (effect.source?.config as { recipe?: string } | undefined)?.recipe ?? "";
  return synthRecipes.has(recipe)
    ? { status: "own", source: `synthesised (${recipe})`, repeatable: true }
    : fallBack(effect, takes, `synthesised (${recipe || "no recipe"})`);
});

/** A sound's readiness, by its provider. */
export const readinessOf = (effect: SoundEffect, takes: TakeCounts): Readiness =>
  sfxReadiness.get(effect.source?.provider ?? "sample")(effect, takes);

/**
 * Play `count` times, `gap` seconds apart (a rapid audition), with the timers given. Returns a
 * cancel that clears every pending play; the first plays at once.
 */
export function playRepeated(
  count: number,
  gap: number,
  play: () => void,
  timers: {
    set: (run: () => void, ms: number) => number;
    clear: (id: number) => void;
  } = {
    set: (run, ms) => window.setTimeout(run, ms),
    clear: (id) => window.clearTimeout(id),
  },
): () => void {
  const pending = Array.from({ length: Math.max(0, count) }, (_, i) =>
    timers.set(play, i * gap * 1000),
  );
  return () => pending.forEach((id) => timers.clear(id));
}
