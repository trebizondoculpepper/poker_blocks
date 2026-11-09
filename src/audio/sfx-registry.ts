/**
 * Sound-effect registry: the single list of every sound the game can play.
 *
 * ADDING A SOUND (for people and coding agents)
 * Every player action and notable game event plays a sound by id: `playSfx("card.attach")`.
 * When you add an action, add a registry entry with an `id` and `trigger`, and call
 * `playSfx` with that id. Audio is always pre-generated and committed, never made at
 * runtime: entries without a file play silently until someone runs `npm run sfx` locally.
 * A `prompt` is welcome if one comes to mind; otherwise it is written when audio is made.
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
    id: "score.magnitude.ones",
    trigger: "One scoring line worth 1 to 9 points is presented, lowest line first",
    prompt:
      "A single small bright glass chime tap, light and quick. Part of a rising family of score sounds; grander through texture, not loudness",
    durationSeconds: 0.5,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "score.magnitude.tens",
    trigger: "One scoring line worth 10 to 99 points is presented, lowest line first",
    prompt:
      "Two quick bright glass chimes with a soft coin-like ring, light and pleasant. Part of a rising family of score sounds; grander through texture, not loudness",
    durationSeconds: 0.6,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "score.magnitude.hundreds",
    trigger: "One scoring line worth 100 to 999 points is presented, lowest line first",
    prompt:
      "A quick sparkling run of three glass chimes with a warm ringing tail. Part of a rising family of score sounds; grander through texture, not loudness",
    durationSeconds: 0.8,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "score.magnitude.thousands",
    trigger: "One scoring line worth 1,000 to 9,999 points is presented, lowest line first",
    prompt:
      "A rich cluster of glass chimes and small bells with a shimmering sparkle, satisfying. Part of a rising family of score sounds; grander through texture, not loudness",
    durationSeconds: 1.0,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "score.magnitude.ten_thousands",
    trigger: "One scoring line worth 10,000 to 99,999 points is presented, lowest line first",
    prompt:
      "A layered cascade of glass chimes, bells and a soft low resonant hum underneath, glittering and grand. Part of a rising family of score sounds; grander through texture, not loudness",
    durationSeconds: 1.2,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "score.magnitude.hundred_thousands",
    trigger: "One scoring line worth 100,000 to 999,999 points is presented, lowest line first",
    prompt:
      "A wide shimmering cascade of many glass chimes and bells over a deep warm resonant bloom, sparkling and majestic. Part of a rising family of score sounds; grander through texture, not loudness",
    durationSeconds: 1.5,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "score.magnitude.millions",
    trigger: "One scoring line worth 1,000,000 points or more is presented, lowest line first",
    prompt:
      "A vast radiant swell of countless glass chimes, bells and crystal shimmer over a deep resonant bloom, magnificent and celebratory. Part of a rising family of score sounds; grander through texture, not loudness",
    durationSeconds: 2.0,
    promptInfluence: 0.6,
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
  {
    id: "round.start",
    trigger: "A new stage begins: the field is cleared and a fresh hand is dealt",
    prompt: "A soft card-shuffle riffle followed by a gentle bright chime, a fresh start",
    durationSeconds: 1.2,
  },
  {
    id: "shop.open",
    trigger: "The shop opens after the boss stage is won",
    prompt: "A cheerful shop-door bell jingle with a soft wooden creak, welcoming",
    durationSeconds: 1.0,
  },
  {
    id: "shop.stock.toss",
    trigger: "The shop offers begin their entrance toss onto the table",
  },
  {
    id: "shop.stock.land",
    trigger: "A tossed shop offer lands on the table",
  },
  {
    id: "shop.buy",
    trigger: "A player buys one shop block and it joins the hand or passive rack",
  },
  {
    id: "shop.stock.burn",
    trigger: "Unbought shop stock burns away when the player leaves the shop",
  },
  {
    id: "run.lost",
    trigger: "A stage is lost and the game ends (bigger than round.failed)",
    prompt: "A slow descending set of soft muted bell tones fading to silence, final but gentle",
    durationSeconds: 2.5,
  },
  {
    id: "ui.click",
    trigger: "A HUD button is pressed",
    prompt: "A crisp tiny soft button click, subtle",
    durationSeconds: 0.5,
  },
  {
    id: "ui.hover",
    trigger: "The pointer moves over a menu button",
    prompt: "A very soft faint airy tick, barely there",
    durationSeconds: 0.5,
  },
  {
    id: "ui.back",
    trigger: "A menu or panel is closed, or a choice is cancelled",
    prompt: "A soft gentle downward two-note click, closing",
    durationSeconds: 0.5,
  },
  {
    id: "hand.reorder",
    trigger: "A hand card is dropped into a new position in the hand",
    prompt: "A soft light card slide ending in a gentle tap, tidy",
    durationSeconds: 0.5,
  },
  {
    id: "view.zoom",
    trigger: "A wheel zoom burst or two-finger pinch begins on the playing field",
  },
  {
    id: "reward.coin",
    trigger: "A coin reward row counts in on the stage-won screen",
    prompt:
      "Single bright cash register coin clink, a coin dropping onto a pile of coins, short and satisfying",
    durationSeconds: 0.5,
    promptInfluence: 0.6,
    variants: 2,
  },
  {
    id: "passive.coins",
    trigger: "A passive awards coins after a discard",
  },
  {
    id: "passive.granted",
    trigger: "A passive grants and installs another passive block",
  },
  {
    id: "ui.screenshot",
    trigger: "The player starts a whole-window 4K screenshot with the keyboard shortcut",
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
