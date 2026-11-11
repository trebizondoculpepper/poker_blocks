/**
 * Sound-effect registry: the single list of every sound the game can play.
 *
 * ADDING A SOUND (for people and coding agents)
 * Every player action and notable game event plays a sound by id: `playSfx("card.attach")`.
 * A sound can be registered before it has audio. Add an entry with:
 *   - `id`: stable, lowercase and dotted, also the file-name stem (`shop.stock.burn`);
 *   - `name`: a short human name ("Stock burn");
 *   - `family`: its group (`shop`), which the listening room groups by;
 *   - `description`: one sentence saying when it plays;
 *   - `placeholder` (optional): an existing sound to play as a **stand-in** until this one has
 *     audio of its own, so the game is never quieter for it.
 * Then call `playSfx("<id>")` where the action happens. The audio can be made or replaced later:
 * add a `prompt` and run `npm run sfx -- <id>` locally. Audio is always pre-generated and
 * committed, never made at runtime; without audio or a stand-in, a sound plays silently.
 * Reuse an existing id when the action should sound the same (e.g. `action.denied`).
 *
 * MAGNITUDE FAMILIES: sounds that differ by size (score bands, say) are still registered here
 * one by one, and also grouped in `src/audio/sfx-families.ts`; callers ask for
 * `familySfx(family, magnitude)` and get the right id back (#235).
 *
 * Audio lives in `src/assets/sfx/<id>.<take>.mp3` and is committed. See doc/sound_design.md.
 */
export type SoundEffect = {
  /** Stable dotted id used by game code, e.g. `card.attach`. Also the file-name stem. */
  id: string;
  /** A short human name, for the listening room and docs. */
  name: string;
  /** The group it belongs to (`card`, `shop`, `score`, …): how the listening room groups it. */
  family: string;
  /** When the game plays it, in one sentence. */
  description: string;
  /** What to ask the generator for; `sfxStyle` is appended. Entries without one are skipped. */
  prompt?: string;
  /** Length in seconds (the API accepts 0.5 to 30). Default `sfxDefaults.durationSeconds`. */
  durationSeconds?: number;
  /** 0 to 1: how literally the generator follows the prompt. Default 0.5. */
  promptInfluence?: number;
  /** How many takes to generate, so frequent sounds can vary. Default 1. */
  variants?: number;
  /**
   * Another sound's id to play until this one has audio of its own (#232), so a new, more
   * specific sound never makes the game quieter than before.
   */
  placeholder?: string;
};

export const sfxDefaults = { durationSeconds: 0.7, promptInfluence: 0.5, variants: 1 } as const;

/** Appended to every prompt so the set sounds like one game. */
export const sfxStyle =
  "Clean, tactile sound effect for a calm 3D puzzle card game. Single isolated sound, dry, no music, no voice.";

const entries = [
  {
    id: "card.select",
    name: "Select",
    family: "card",
    description: "A card block is clicked and becomes selected",
    prompt: "Light bright tick, a playing card lifted slightly, soft rising tone",
    durationSeconds: 0.5,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "card.deselect",
    name: "Deselect",
    family: "card",
    description: "A selected card block is clicked and becomes unselected",
    prompt: "Soft low tick, a playing card set back down, gentle falling tone",
    durationSeconds: 0.5,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "card.pickup",
    name: "Pickup",
    family: "card",
    description: "A drag starts on a hand block",
    prompt: "Quick soft swish of picking a small wooden block up off a felt table",
    durationSeconds: 0.5,
    promptInfluence: 0.5,
    variants: 1,
  },
  {
    id: "card.drag.snap",
    name: "Drag snap",
    family: "card",
    description: "A valid attachment face comes under the dragged block",
    prompt: "Very short faint magnetic click, a subtle snap-guide cue",
    durationSeconds: 0.5,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "card.drag.return",
    name: "Drag return",
    family: "card",
    description: "A dragged block is dropped on nothing and returns to the hand",
    prompt: "Soft quick whoosh back into place followed by a gentle muted tap",
    durationSeconds: 0.6,
    promptInfluence: 0.5,
    variants: 1,
  },
  {
    id: "card.place.fly",
    name: "Place fly",
    family: "card",
    description: "A placed block flies from the hand to its cell, growing to full size",
    prompt: "Smooth airy whoosh that swells, an object gliding and growing",
    durationSeconds: 1,
    promptInfluence: 0.5,
    variants: 1,
  },
  {
    id: "card.attach",
    name: "Attach",
    family: "card",
    description: "A placed block lands and locks into its cell",
    prompt: "Solid wooden block snapping firmly into place, satisfying chunky click",
    durationSeconds: 0.6,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "discard.hover",
    name: "Hover",
    family: "discard",
    description: "A dragged block moves over the discard bin",
    prompt: "Soft low hum swelling briefly, a bin glowing ready to accept",
    durationSeconds: 0.6,
    promptInfluence: 0.5,
    variants: 1,
  },
  {
    id: "card.discard",
    name: "Discard",
    family: "card",
    description: "A block is dropped in the discard bin and dissolves",
    prompt: "Sparkling dissolve, a small block breaking into fading particles, airy fizz",
    durationSeconds: 1,
    promptInfluence: 0.5,
    variants: 1,
  },
  {
    id: "card.deal",
    name: "Deal",
    family: "card",
    description: "A new block is drawn into the hand and materialises",
    prompt: "Quick card deal flick with a soft shimmer as it appears",
    durationSeconds: 0.7,
    promptInfluence: 0.5,
    variants: 1,
  },
  {
    id: "block.destroyed",
    name: "Destroyed",
    family: "block",
    description: "A block on the table is destroyed and vanishes, leaving a gap",
    prompt: "Short crumbling crack of a small wooden block breaking apart, dry and light",
    durationSeconds: 0.6,
  },
  {
    id: "action.denied",
    name: "Denied",
    family: "action",
    description: "An action is refused: no plays or discards left, or an invalid drop",
    prompt: "Short soft muted double thud, a gentle no, not harsh",
    durationSeconds: 0.5,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "score.line",
    name: "Line",
    family: "score",
    description: "One line scores; replayed at rising pitch for each line in a chain",
    prompt: "Bright short chime with a coin-like ring, positive and clean",
    durationSeconds: 0.5,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "score.big",
    name: "Big",
    family: "score",
    description: "A play scores a large amount or a strong hand",
    prompt: "Rich rising cascade of chimes and shimmer ending in a warm ring, rewarding",
    durationSeconds: 1.5,
    promptInfluence: 0.5,
    variants: 1,
  },
  {
    id: "score.magnitude.ones",
    name: "Magnitude ones",
    family: "score",
    description: "One scoring line worth 1 to 9 points is presented, lowest line first",
    prompt:
      "A single small bright glass chime tap, light and quick. Part of a rising family of score sounds; grander through texture, not loudness",
    durationSeconds: 0.5,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "score.magnitude.tens",
    name: "Magnitude tens",
    family: "score",
    description: "One scoring line worth 10 to 99 points is presented, lowest line first",
    prompt:
      "Two quick bright glass chimes with a soft coin-like ring, light and pleasant. Part of a rising family of score sounds; grander through texture, not loudness",
    durationSeconds: 0.6,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "score.magnitude.hundreds",
    name: "Magnitude hundreds",
    family: "score",
    description: "One scoring line worth 100 to 999 points is presented, lowest line first",
    prompt:
      "A quick sparkling run of three glass chimes with a warm ringing tail. Part of a rising family of score sounds; grander through texture, not loudness",
    durationSeconds: 0.8,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "score.magnitude.thousands",
    name: "Magnitude thousands",
    family: "score",
    description: "One scoring line worth 1,000 to 9,999 points is presented, lowest line first",
    prompt:
      "A rich cluster of glass chimes and small bells with a shimmering sparkle, satisfying. Part of a rising family of score sounds; grander through texture, not loudness",
    durationSeconds: 1.0,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "score.magnitude.ten_thousands",
    name: "Magnitude ten thousands",
    family: "score",
    description: "One scoring line worth 10,000 to 99,999 points is presented, lowest line first",
    prompt:
      "A layered cascade of glass chimes, bells and a soft low resonant hum underneath, glittering and grand. Part of a rising family of score sounds; grander through texture, not loudness",
    durationSeconds: 1.2,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "score.magnitude.hundred_thousands",
    name: "Magnitude hundred thousands",
    family: "score",
    description: "One scoring line worth 100,000 to 999,999 points is presented, lowest line first",
    prompt:
      "A wide shimmering cascade of many glass chimes and bells over a deep warm resonant bloom, sparkling and majestic. Part of a rising family of score sounds; grander through texture, not loudness",
    durationSeconds: 1.5,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "score.magnitude.millions",
    name: "Magnitude millions",
    family: "score",
    description: "One scoring line worth 1,000,000 points or more is presented, lowest line first",
    prompt:
      "A vast radiant swell of countless glass chimes, bells and crystal shimmer over a deep resonant bloom, magnificent and celebratory. Part of a rising family of score sounds; grander through texture, not loudness",
    durationSeconds: 2.0,
    promptInfluence: 0.6,
    variants: 1,
  },
  {
    id: "round.cleared",
    name: "Cleared",
    family: "round",
    description: "The running total reaches the target score",
    // A cheeky meme-style "rizz" sting (#315): original audio, in the spirit of the memed clip.
    prompt:
      "Cheeky smug meme sound effect: a smooth funky slap bass riff sliding up, then a twangy cartoon boing and a sparkly wink chime, confident, cocky, playful and comedic",
    durationSeconds: 2.5,
    promptInfluence: 0.5,
    variants: 1,
  },
  {
    id: "round.failed",
    name: "Failed",
    family: "round",
    description: "Plays run out before the target score is reached",
    prompt: "Gentle descending deflating tones, a soft sad wind-down, not harsh",
    durationSeconds: 2,
    promptInfluence: 0.5,
    variants: 1,
  },
  {
    id: "round.start",
    name: "Start",
    family: "round",
    description: "A new stage begins: the field is cleared and a fresh hand is dealt",
    prompt: "A soft card-shuffle riffle followed by a gentle bright chime, a fresh start",
    durationSeconds: 1.2,
  },
  {
    id: "shop.open",
    name: "Open",
    family: "shop",
    description: "The shop opens after the boss stage is won",
    prompt: "A cheerful shop-door bell jingle with a soft wooden creak, welcoming",
    durationSeconds: 1.0,
  },
  {
    id: "shop.stock.toss",
    name: "Stock toss",
    family: "shop",
    description: "The shop offers begin their entrance toss onto the table",
    prompt: "Soft whoosh of several small blocks tossed in an arc across a felt table",
  },
  {
    id: "shop.stock.land",
    name: "Stock land",
    family: "shop",
    description: "A tossed shop offer lands on the table",
    prompt: "Single small wooden block landing on green felt, soft muted thud",
  },
  {
    id: "shop.buy",
    name: "Buy",
    family: "shop",
    description: "A player buys one shop block and it joins the deck or passive rack",
    prompt: "Cheerful short cash register ding with a coin clink, a purchase made",
  },
  {
    id: "shop.buy.denied",
    name: "Can't afford",
    family: "shop",
    description: "An offer dropped on BUY costs more coins than the player holds",
    prompt:
      "Cash register refusing a sale: a short flat electronic buzz and the hollow clunk of an empty till drawer, no coins",
    durationSeconds: 0.7,
    placeholder: "action.denied",
  },
  {
    id: "shop.stock.burn",
    name: "Stock burn",
    family: "shop",
    description: "Unbought shop stock burns away when the player leaves the shop",
    prompt: "Quick soft whoosh of paper catching fire and crumbling to ash",
  },
  {
    id: "run.lost",
    name: "Lost",
    family: "run",
    description: "A stage is lost and the game ends (bigger than round.failed)",
    prompt: "A slow descending set of soft muted bell tones fading to silence, final but gentle",
    durationSeconds: 2.5,
  },
  {
    id: "attract.card.bonk",
    name: "Card bonk",
    family: "attract",
    description: "A card in the title's attract sequence flies into the camera and bounces off it",
    prompt:
      "Comic hollow bonk of a small wooden block knocking against a glass lens, cartoonish and light",
    durationSeconds: 0.6,
    variants: 3,
  },
  {
    id: "ui.click",
    name: "Click",
    family: "ui",
    description: "A HUD button is pressed",
    prompt: "A crisp tiny soft button click, subtle",
    durationSeconds: 0.5,
  },
  {
    id: "ui.hover",
    name: "Hover",
    family: "ui",
    description: "The pointer moves over a menu button",
    prompt: "A very soft faint airy tick, barely there",
    durationSeconds: 0.5,
  },
  {
    id: "ui.back",
    name: "Back",
    family: "ui",
    description: "A menu or panel is closed, or a choice is cancelled",
    prompt: "A soft gentle downward two-note click, closing",
    durationSeconds: 0.5,
  },
  {
    id: "hand.reorder",
    name: "Reorder",
    family: "hand",
    description: "A hand card or installed passive is dropped into a new position in its rack",
    prompt: "A soft light card slide ending in a gentle tap, tidy",
    durationSeconds: 0.5,
  },
  {
    id: "view.zoom",
    name: "Zoom",
    family: "view",
    description: "A wheel zoom burst or two-finger pinch begins on the playing field",
  },
  {
    id: "reward.coin",
    name: "Coin",
    family: "reward",
    description: "A coin reward row counts in on the stage-won screen",
    prompt:
      "Single bright cash register coin clink, a coin dropping onto a pile of coins, short and satisfying",
    durationSeconds: 0.5,
    promptInfluence: 0.6,
    variants: 2,
  },
  {
    id: "passive.coins",
    name: "Coins",
    family: "passive",
    description: "A passive awards coins after a discard",
  },
  {
    id: "passive.granted",
    name: "Granted",
    family: "passive",
    description: "A passive grants and installs another passive block",
  },
  {
    id: "item.apply",
    name: "Use item",
    family: "passive",
    description:
      "A rack item is dropped on a card and used on it (a transmogrifier changes its material)",
    placeholder: "passive.activate.scoring",
  },
  {
    id: "passive.activate.scoring",
    name: "Activate scoring",
    family: "passive",
    description: "A scoring-category passive activates and changes a score",
    prompt: "A light, clean porcelain chime, single soft ding, short and bright",
  },
  {
    id: "material.attach.meat",
    name: "Attach meat",
    family: "material",
    description: "A block lands where meat is the softer of the two materials meeting (#232)",
    prompt: "Wet, squishy slap of raw meat pressed onto a block, soft and fleshy",
    durationSeconds: 0.6,
    placeholder: "card.attach",
  },
  {
    id: "material.attach.paper",
    name: "Attach paper",
    family: "material",
    description: "A block lands where paper is the softer of the two materials meeting (#232)",
    prompt: "Flimsy papery tap, a stiff card pressed lightly onto a block",
    durationSeconds: 0.6,
    placeholder: "card.attach",
  },
  {
    id: "material.attach.wood",
    name: "Attach wood",
    family: "material",
    description: "A block lands where wood is the softer of the two materials meeting (#232)",
    prompt: "Solid wooden block snapping firmly into place, satisfying chunky click",
    durationSeconds: 0.6,
    placeholder: "card.attach",
  },
  {
    id: "material.attach.custard",
    name: "Attach custard",
    family: "material",
    description: "A block lands where custard is the softer of the two materials meeting (#232)",
    prompt: "Hollow plastic tub clicking into place, with a soft gloopy wobble inside",
    durationSeconds: 0.6,
    placeholder: "card.attach",
  },
  {
    id: "material.attach.ice",
    name: "Attach ice",
    family: "material",
    description: "A block lands where ice is the softer of the two materials meeting (#232)",
    prompt: "Crisp icy clink of a frozen cube set against another block",
    durationSeconds: 0.6,
    placeholder: "card.attach",
  },
  {
    id: "material.attach.terracotta",
    name: "Attach terracotta",
    family: "material",
    description: "A block lands where terracotta is the softer of the two materials meeting (#232)",
    prompt: "Dry clay knock, a fired pot tile set down firmly",
    durationSeconds: 0.6,
    placeholder: "card.attach",
  },
  {
    id: "material.attach.gold",
    name: "Attach gold",
    family: "material",
    description: "A block lands where gold is the softer of the two materials meeting (#232)",
    prompt: "Dense, warm metallic thunk of a heavy gold ingot settling",
    durationSeconds: 0.6,
    placeholder: "card.attach",
  },
  {
    id: "material.attach.steel",
    name: "Attach steel",
    family: "material",
    description: "A block lands where steel is the softer of the two materials meeting (#232)",
    prompt: "Bright clanking steel plate locking into place",
    durationSeconds: 0.6,
    placeholder: "card.attach",
  },
  {
    id: "material.attach.fire",
    name: "Attach fire",
    family: "material",
    description: "A block lands where fire is the softer of the two materials meeting (#232)",
    prompt: "Iron frame clank with a faint crackle of flame",
    durationSeconds: 0.6,
    placeholder: "card.attach",
  },
  {
    id: "material.attach.prismatic",
    name: "Attach prismatic",
    family: "material",
    description: "A block lands where prismatic is the softer of the two materials meeting (#232)",
    prompt: "Bright glassy crystal ting, a gem set into a hard setting",
    durationSeconds: 0.6,
    placeholder: "card.attach",
  },
  {
    id: "passive.pickup",
    name: "Pickup",
    family: "passive",
    description: "A passive is lifted out of the rack to move or sell it",
    prompt: "Light porcelain token lifted off a shelf, a soft bright clink",
    placeholder: "card.pickup",
  },
  {
    id: "shop.leave",
    name: "Leave",
    family: "shop",
    description: "The player leaves the shop for the next round",
    prompt: "Shop door closing with a small bell jingle, gentle and final",
    placeholder: "shop.open",
  },
  {
    id: "material.activate.wood",
    name: "Activate wood",
    family: "material",
    description: "A wood card's scoring modifier activates as its line is presented",
  },
  {
    id: "material.activate.gold",
    name: "Activate gold",
    family: "material",
    description: "A gold card's scoring modifier activates as its line is presented",
  },
  {
    id: "material.activate.steel",
    name: "Activate steel",
    family: "material",
    description: "A steel card's scoring modifier activates as its line is presented",
  },
  {
    id: "material.activate.custard",
    name: "Activate custard",
    family: "material",
    description: "A custard card's scoring modifier activates as its line is presented",
    placeholder: "passive.activate.scoring",
  },
  {
    id: "reaction.heat",
    name: "Heat",
    family: "material",
    description: "Water beside flame heats into hot water as a play settles",
    placeholder: "material.attach.fire",
  },
  {
    id: "reaction.stoke",
    name: "Stoke",
    family: "material",
    description: "Air beside flame stokes it into aggressive flame as a play settles",
    placeholder: "material.attach.fire",
  },
  {
    id: "reaction.boil",
    name: "Boil",
    family: "material",
    description: "Water beside aggressive flame boils as a play settles",
    placeholder: "material.attach.fire",
  },
  {
    id: "reaction.cook",
    name: "Cook",
    family: "material",
    description: "Meat beside flame or boiling water cooks one step as a play settles",
    placeholder: "material.attach.meat",
  },
  {
    id: "reaction.bake",
    name: "Bake",
    family: "material",
    description: "Earth beside flame bakes into terracotta as a play settles",
    placeholder: "material.attach.terracotta",
  },
  {
    id: "reaction.melt",
    name: "Melt",
    family: "material",
    description: "Ice beside flame or hot water melts into water as a play settles",
    placeholder: "material.attach.ice",
  },
  {
    id: "reaction.condense",
    name: "Condense",
    family: "material",
    description: "Air beside boiling water makes a new cloud beyond the pair as a play settles",
    placeholder: "material.attach.ice",
  },
  {
    id: "reaction.freeze",
    name: "Freeze",
    family: "material",
    description:
      "Custard beside ice, with no heat beside it, freezes into gelato as a play settles",
    placeholder: "material.attach.ice",
  },
  {
    id: "reaction.thaw",
    name: "Thaw",
    family: "material",
    description: "Gelato beside a source of heat thaws back into custard as a play settles",
    placeholder: "material.attach.fire",
  },
  {
    id: "material.activate.prismatic",
    name: "Activate prismatic",
    family: "material",
    description: "A prismatic crystal card's scoring modifier activates as its line is presented",
  },
  {
    id: "material.activate.magic",
    name: "Activate magic",
    family: "material",
    description: "A Magic card's scoring modifier activates as its line is presented",
    placeholder: "passive.activate.scoring",
  },
  {
    id: "material.activate.cloud",
    name: "Activate cloud",
    family: "material",
    description: "A cloud's scoring package applies to the line it is in as that line is presented",
    placeholder: "passive.activate.scoring",
  },
  {
    id: "material.activate.gelato",
    name: "Activate gelato",
    family: "material",
    description: "A gelato card's scoring modifier activates as its line is presented",
    placeholder: "passive.activate.scoring",
  },
  {
    id: "passive.activate.economy",
    name: "Activate economy",
    family: "passive",
    description: "An economy-category passive activates and pays or changes coins",
    prompt: "A small bright brass coin glint, one quick metallic ting",
  },
  {
    id: "passive.activate.effect",
    name: "Activate effect",
    family: "passive",
    description: "An effect-category passive activates and changes a rule or the cards",
    prompt: "A soft low click with a faint dark undertone, very short",
  },
  {
    id: "passive.activate.retrigger",
    name: "Activate retrigger",
    family: "passive",
    description: "A retrigger-category passive activates and repeats an effect",
    prompt: "A short double tick, two quick light clicks in a row",
  },
  {
    id: "ui.title.enter",
    name: "Title enter",
    family: "ui",
    description: "The title screen comes in front",
    prompt: "Warm welcoming two-note chime, a game menu opening",
    placeholder: "ui.click",
  },
  {
    id: "ui.title.exit",
    name: "Title exit",
    family: "ui",
    description: "The title screen closes as a game starts or continues",
    prompt: "Soft rising swoosh into the game, light and inviting",
    placeholder: "card.place.fly",
  },
  {
    id: "ui.settings.enter",
    name: "Settings enter",
    family: "ui",
    description: "The settings screen opens",
    prompt: "Soft panel sliding open with a gentle tick",
    placeholder: "card.select",
  },
  {
    id: "ui.settings.exit",
    name: "Settings exit",
    family: "ui",
    description: "The settings screen closes",
    prompt: "Soft panel sliding shut with a gentle low tick",
    placeholder: "ui.back",
  },
  {
    id: "ui.screenshot",
    name: "Screenshot",
    family: "ui",
    description: "The player starts a whole-window 4K screenshot with the keyboard shortcut",
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
): Required<Omit<SoundEffect, "prompt" | "placeholder">> &
  Pick<SoundEffect, "prompt" | "placeholder"> {
  return { ...sfxDefaults, ...effect };
}
