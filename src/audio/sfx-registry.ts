/**
 * Sound-effect registry: the single list of every sound the game can play.
 *
 * ADDING A SOUND (for people and coding agents)
 * Every player action and notable game event plays a sound by id: `playSfx("card.attach")`.
 * When you add an action, add a registry entry with an `id` and `trigger`, and call
 * `playSfx` with that id. That is all. Do NOT generate audio: entries without a file
 * play silently until someone runs `npm run sfx` locally. A `prompt` is welcome if one
 * comes to mind; otherwise leave it out and it will be written when audio is generated.
 * Reuse an existing id when the action should sound the same (e.g. `action.denied`).
 *
 * Audio lives in `src/assets/sfx/<id>.<take>.mp3` and is committed. See doc/sound_design.md.
 */
export type SoundEffect = {
  /** Stable dotted id used by game code, e.g. `card.attach`. Also the file-name stem. */
  id: string;
  /** When the game plays it. */
  trigger: string;
  /** What to ask the generator for; `sfxStyle` is appended. Entries without one are skipped. */
  prompt?: string;
  /** Length in seconds (the API accepts 0.5 to 30). Default `sfxDefaults.durationSeconds`. */
  durationSeconds?: number;
  /** 0 to 1: how literally the generator follows the prompt. Default 0.5. */
  promptInfluence?: number;
  /** How many takes to generate, so frequent sounds can vary. Default 1. */
  variants?: number;
};

export const sfxDefaults = { durationSeconds: 0.7, promptInfluence: 0.5, variants: 1 } as const;

/** Appended to every prompt so the set sounds like one game. */
export const sfxStyle =
  "Clean, tactile sound effect for a calm 3D puzzle card game. Single isolated sound, dry, no music, no voice.";

const entries = [
  {
    id: "card.select",
    trigger: "A card block is clicked and becomes selected",
    prompt: "Light bright tick, a playing card lifted slightly, soft rising tone",
    durationSeconds: 0.5,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "card.deselect",
    trigger: "A selected card block is clicked and becomes unselected",
    prompt: "Soft low tick, a playing card set back down, gentle falling tone",
    durationSeconds: 0.5,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "card.pickup",
    trigger: "A drag starts on a hand block",
    prompt: "Quick soft swish of picking a small wooden block up off a felt table",
    durationSeconds: 0.5,
    promptInfluence: 0.5,
    variants: 1,
  },
  {
    id: "card.drag.snap",
    trigger: "A valid attachment face comes under the dragged block",
    prompt: "Very short faint magnetic click, a subtle snap-guide cue",
    durationSeconds: 0.5,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "card.drag.return",
    trigger: "A dragged block is dropped on nothing and returns to the hand",
    prompt: "Soft quick whoosh back into place followed by a gentle muted tap",
    durationSeconds: 0.6,
    promptInfluence: 0.5,
    variants: 1,
  },
  {
    id: "card.place.fly",
    trigger: "A placed block flies from the hand to its cell, growing to full size",
    prompt: "Smooth airy whoosh that swells, an object gliding and growing",
    durationSeconds: 1,
    promptInfluence: 0.5,
    variants: 1,
  },
  {
    id: "card.attach",
    trigger: "A placed block lands and locks into its cell",
    prompt: "Solid wooden block snapping firmly into place, satisfying chunky click",
    durationSeconds: 0.6,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "discard.hover",
    trigger: "A dragged block moves over the discard bin",
    prompt: "Soft low hum swelling briefly, a bin glowing ready to accept",
    durationSeconds: 0.6,
    promptInfluence: 0.5,
    variants: 1,
  },
  {
    id: "card.discard",
    trigger: "A block is dropped in the discard bin and dissolves",
    prompt: "Sparkling dissolve, a small block breaking into fading particles, airy fizz",
    durationSeconds: 1,
    promptInfluence: 0.5,
    variants: 1,
  },
  {
    id: "card.deal",
    trigger: "A new block is drawn into the hand and materialises",
    prompt: "Quick card deal flick with a soft shimmer as it appears",
    durationSeconds: 0.7,
    promptInfluence: 0.5,
    variants: 1,
  },
  {
    id: "action.denied",
    trigger: "An action is refused: no plays or discards left, or an invalid drop",
    prompt: "Short soft muted double thud, a gentle no, not harsh",
    durationSeconds: 0.5,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "score.line",
    trigger: "One line scores; replayed at rising pitch for each line in a chain",
    prompt: "Bright short chime with a coin-like ring, positive and clean",
    durationSeconds: 0.5,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "score.big",
    trigger: "A play scores a large amount or a strong hand",
    prompt: "Rich rising cascade of chimes and shimmer ending in a warm ring, rewarding",
    durationSeconds: 1.5,
    promptInfluence: 0.5,
    variants: 1,
  },
  {
    id: "round.cleared",
    trigger: "The running total reaches the target score",
    prompt: "Short triumphant celebratory flourish of bells and sparkles, uplifting",
    durationSeconds: 2.5,
    promptInfluence: 0.5,
    variants: 1,
  },
  {
    id: "round.failed",
    trigger: "Plays run out before the target score is reached",
    prompt: "Gentle descending deflating tones, a soft sad wind-down, not harsh",
    durationSeconds: 2,
    promptInfluence: 0.5,
    variants: 1,
  },
] as const satisfies readonly SoundEffect[];

/** Every registered sound. Add new entries to the list above. */
export const soundEffects: readonly SoundEffect[] = entries;

/** Ids the game may play. Using an unregistered id is a type error. */
export type SoundEffectId = (typeof entries)[number]["id"];

/** File names (without directory) for every take of a sound. */
export function sfxFileNames(effect: Pick<SoundEffect, "id" | "variants">): string[] {
  const variants = effect.variants ?? sfxDefaults.variants;
  return Array.from({ length: variants }, (_, index) => `${effect.id}.${index + 1}.mp3`);
}

/** An entry with every generation setting filled in. */
export function withSfxDefaults(
  effect: SoundEffect,
): Required<Omit<SoundEffect, "prompt">> & Pick<SoundEffect, "prompt"> {
  return { ...sfxDefaults, ...effect };
}
