# Sound design

Every sound the game needs, the moment it plays, and whether it exists yet. The rules these sounds support are in [game.md](game.md).

## Approach

- **One registry.** [`src/audio/sfx-registry.ts`](../src/audio/sfx-registry.ts) lists each sound: its id, trigger, generation prompt, duration and number of variants. Game code refers to sounds only by id.
- **Generated once, locally.** `npm run sfx` (which runs `scripts/generate-sfx.ts`) calls the ElevenLabs sound-effects API for any registry entry that has no file yet. The key comes from `ELEVENLABS_API_KEY`, either in your environment or in a git-ignored `.env` file at the project root. The results are committed under `src/assets/sfx/<id>.<variant>.mp3`, so builds and CI never need the key. Pass ids to generate only those sounds, and `--force` to regenerate files that already exist.
- **Every action has a sound.** Game code calls `playSfx(id)` from [`src/audio/sfx.ts`](../src/audio/sfx.ts) for each player action and notable event. The id is type-checked against the registry.
- **Register first, generate later.** A registry entry needs only an `id` and a `trigger`. The prompt and generation settings are optional, and a sound with no audio file plays silently. This lets anyone, including coding agents, add the sound for a new action without writing a prompt or generating audio. Audio is generated in batches: `npm run sfx -- --list` shows which entries still need a prompt and which are ready to generate. The rules for agents are in [AGENTS.md](../AGENTS.md).
- **Checked by a test.** [`sfx-registry.test.ts`](../src/audio/sfx-registry.test.ts) checks that ids are unique and well formed, that each entry has a trigger, and that every audio file belongs to a registry entry. Missing audio is allowed.
- **Listening room.** With the dev server running, open `/sfx.html` to hear every sound. It shows each sound's trigger and prompt, and has volume, pitch and random-pitch controls, plus a chain preview that plays any registered sound five times at rising pitch (pick it from the list, or open `/sfx.html?sound=<id>`). Number keys play sounds 1 to 10, and Esc stops playback. It is a development page and is not part of the production build.
- **One style.** Every prompt has a shared style line appended (`sfxStyle`): clean, tactile, dry, no music and no voice. This keeps the set sounding like one game.
- **Variety without extra files.** Sounds that repeat often (dealing, line scores, counter ticks) are played at slightly random pitch. A chain of line scores replays one sound at rising pitch, instead of using a separate file for each step. Add variants only where pitch changes alone sound repetitive.
- **Additions keep score readable.** Sounds for adding to a score and for multiplying it must be easy to tell apart, so players can hear what kind of combination happened.

Status: **generated** means the file exists. **Registered** means the entry exists but has no audio yet. **Planned** means the sound is not in the registry yet. Add a planned sound to the registry when the feature it belongs to is built.

### Usage record and the listening room

`src/audio/sfx-usage.json` is the registry's record of where each sound is used. For each id it gives how many places name it, and in which files. That covers `playSfx` calls, data that names a sound (scene `enterSound`, material activations, family variants), and registry entries that use it as their `placeholder`. Run `npm run sfx:usage` after adding, removing or moving a sound; `src/audio/sfx-usage.test.ts` fails while the record is out of date.

The listening room (`/sfx.html`) reads the record:

- each row shows **used ×N**, with the files listed on hover, or **unused**;
- a **Show** filter lists all sounds, only used ones, or only unused ones;
- each row's **Copy** button copies the sound's id.

## Hand and placement (current game)

| Id                 | Plays when                                                          | Status    |
| ------------------ | ------------------------------------------------------------------- | --------- |
| `card.select`      | A card block is clicked and becomes selected                        | generated |
| `card.deselect`    | A selected block is clicked and becomes unselected                  | generated |
| `card.pickup`      | A drag starts on a hand block                                       | generated |
| `card.drag.snap`   | A valid attachment face comes under the dragged block               | generated |
| `card.drag.return` | A dragged block is dropped on nothing and returns to the hand       | generated |
| `card.place.fly`   | A placed block flies to its cell, growing to full size              | generated |
| `card.attach`      | Placeholder for every `material.attach.*` sound until it has audio  | generated |
| `discard.hover`    | A dragged block moves over the discard bin                          | generated |
| `card.discard`     | A block is dropped in the discard bin and dissolves                 | generated |
| `hand.reorder`     | A hand card or passive is dropped into a new position in its rack   | generated |
| `card.deal`        | A new block is drawn into the hand                                  | generated |
| `action.denied`    | An action is refused: no plays or discards left, or an invalid drop | generated |
| `board.rotate`     | The player drags to rotate the structure (quiet, optional)          | planned   |
| `card.inspect`     | The hover tooltip opens (very subtle, optional)                     | planned   |

### Attachment sounds by material (#232)

When a block lands, the **softer** of the two materials that meet decides the sound: the landed block's own material, or its softest neighbour's if that is softer. On an empty table the block meets only itself. Each material's `acoustics` data (in `src/materials.ts`) gives a `hardness` (higher is harder), the `attach` sound, and a `character` word. `attachmentSound` in `src/attachment-sound.ts` is the generic resolver and never names a material. When several blocks land together, each distinct sound plays once. Every `material.attach.*` id names `card.attach` as its `placeholder` and plays that sound until its own audio is generated (`npm run sfx -- material.attach.<material>`).

Proposed palette, softest first:

| Hardness | Material   | Character | Sound id                     | Prompt idea                                 |
| -------- | ---------- | --------- | ---------------------------- | ------------------------------------------- |
| 1        | Meat       | squishy   | `material.attach.meat`       | wet, squishy slap                           |
| 2        | Paper      | flimsy    | `material.attach.paper`      | flimsy papery tap                           |
| 3        | Wood       | knocking  | `material.attach.wood`       | chunky wooden click (today's `card.attach`) |
| 5        | Ice        | clinking  | `material.attach.ice`        | crisp icy clink                             |
| 6        | Terracotta | dry       | `material.attach.terracotta` | dry clay knock                              |
| 7        | Gold       | dense     | `material.attach.gold`       | heavy, warm metallic thunk                  |
| 8        | Steel      | clanking  | `material.attach.steel`      | bright steel clank                          |
| 9        | Fire       | rattling  | `material.attach.fire`       | iron frame clank with a faint crackle       |
| 10       | Crystal    | ringing   | `material.attach.prismatic`  | bright glassy ting                          |

Hardness 4 is **plastic**, which the owner places between wood and gold: the custard vessel from #227 (`material.attach.custard`, character "hollow"). Custard is an experimental material, seen only in `?mode=dev-custard`.

**For owner review:**

- **Wood (3), below plastic:** as directed.
- **Ice (5) and terracotta (6):** these are proposals. Both sit between plastic and gold, and either could reasonably be harder than gold.
- **Fire (9):** sits above steel because its block is an iron frame.

## Scoring and rounds

| Id                                                  | Plays when                                                                                                                             | Status    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `score.line`                                        | One line scores; replayed at rising pitch for each line in a chain                                                                     | generated |
| `score.big`                                         | A play scores a large amount or a strong hand                                                                                          | generated |
| `score.magnitude.ones` … `score.magnitude.millions` | One scoring line is presented; seven tiers by its points (1–9, 10–99, … 1,000,000+), each grander through texture rather than loudness | generated |
| `score.hand.pair`                                   | A line scores a pair or two pair                                                                                                       | planned   |
| `score.hand.set`                                    | A line scores three or four of a kind                                                                                                  | planned   |
| `score.hand.five`                                   | A line scores a five-card hand: straight, flush, full house or straight flush                                                          | planned   |
| `score.hand.special`                                | A line scores a hand that needs a modified deck, such as five of a kind                                                                | planned   |
| `score.total.tick`                                  | The running total counts up                                                                                                            | planned   |
| `score.target.near`                                 | The running total gets close to the target                                                                                             | planned   |
| `plays.last`                                        | The last play of the stage begins                                                                                                      | planned   |
| `round.start`                                       | The deck is shuffled and the centre block appears                                                                                      | generated |
| `round.cleared`                                     | The running total reaches the target score                                                                                             | generated |
| `round.failed`                                      | Plays run out before the target is reached                                                                                             | generated |

### Sound families by magnitude (#235)

Some sounds come in sizes. Each size is still its own registered sound (its own id, prompt and files), and `src/audio/sfx-families.ts` groups them into a **family**. A caller asks for a family at a magnitude: `familySfx("score.magnitude", points)`. The resolver is generic and never names a family.

- **Variants:** each variant covers magnitudes from its `from` up to the next variant's `from`. The variants are in ascending order, and the top one is open-ended (+Infinity takes it).
- **Outside the family:** a magnitude below the first variant's `from`, or NaN, resolves to `null`, which means no sound.
- **Checks:** every variant must be a registered sound id, in ascending order. `src/audio/sfx-families.test.ts` checks each family's boundaries and the outside rule.
- **One-off sounds:** these stay plain registry entries, played with `playSfx(id)` as before.

The first family is `score.magnitude` (#1). Its bands start at 1, 10, 100, 1,000, 10,000, 100,000 and 1,000,000 points, keep the same ids and generated audio, and are what `magnitudeSfxFor` now resolves through.

## Modifiers and materials

| Id                            | Plays when                                                                   | Status                    |
| ----------------------------- | ---------------------------------------------------------------------------- | ------------------------- |
| `modifier.held.trigger`       | A modifier block in the hand affects play                                    | planned                   |
| `modifier.placed.trigger`     | A modifier block on the field affects play                                   | planned                   |
| `score.add`                   | An effect adds to a score                                                    | planned                   |
| `score.multiply`              | An effect multiplies a score (must sound clearly different from `score.add`) | planned                   |
| `effect.retrigger`            | An effect fires again                                                        | planned                   |
| `material.activate.wood`      | A wood card's scoring rule fires as its line is presented                    | registered; audio pending |
| `material.activate.steel`     | A steel card's scoring rule fires as its line is presented                   | registered; audio pending |
| `material.activate.prismatic` | A crystal card's scoring rule fires as its line is presented                 | registered; audio pending |
| `hand.upgrade`                | A hand type's base score is upgraded                                         | planned                   |
| `block.destroy`               | A block is removed from the field (if removal is adopted)                    | planned                   |
| `block.explode`               | An explosive block goes off (if adopted)                                     | planned                   |

## Coins and shop

| Id                   | Plays when                                          | Status     |
| -------------------- | --------------------------------------------------- | ---------- |
| `coin.earn`          | Coins are earned, from a stage win or a block       | planned    |
| `coin.spend`         | Coins are spent                                     | planned    |
| `shop.open`          | The shop opens after a boss stage                   | generated  |
| `shop.buy`           | A block is bought                                   | planned    |
| `shop.stock.burn`    | Unbought stock burns away when leaving the shop     | registered |
| `shop.cannot_afford` | The player tries to buy something they can't afford | planned    |
| `deck.add_block`     | A bought block joins the deck                       | planned    |
| `shop.leave`         | The player leaves the shop for the next round       | planned    |

## Bosses and the run

| Id                  | Plays when                                                    | Status    |
| ------------------- | ------------------------------------------------------------- | --------- |
| `boss.intro`        | A boss stage begins and shows its rule                        | planned   |
| `boss.rule.applied` | A boss restriction affects play                               | planned   |
| `run.won`           | The final boss stage is beaten (bigger than `round.cleared`)  | planned   |
| `run.lost`          | A stage is lost and the run ends (bigger than `round.failed`) | generated |

## Interface

| Id         | Plays when                                          | Status    |
| ---------- | --------------------------------------------------- | --------- |
| `ui.hover` | The pointer moves over a menu button                | generated |
| `ui.click` | A button is pressed                                 | generated |
| `ui.back`  | A menu or panel is closed, or a choice is cancelled | generated |

## Title screen

| Id                  | Plays when                                                                   | Status     |
| ------------------- | ---------------------------------------------------------------------------- | ---------- |
| `attract.card.bonk` | A card in the title's attract sequence flies into the camera and bounces off | registered |

## Coverage audit (#234, 2026-11-10)

Snapshot of `main` at the audit. It compares `src/audio/sfx-registry.ts` (48 entries), the call sites in `src/`, the committed audio under `src/assets/sfx/`, and the tables above. Two open PRs change this picture: #237 adds the `material.attach.*` sounds and #240 adds sound families. No code or registry entry is changed by this audit.

### Registered, played, and with audio (31)

These are complete: `card.select`, `card.deselect`, `card.pickup`, `card.drag.snap`, `card.drag.return`, `card.place.fly`, `card.attach`, `discard.hover`, `card.discard`, `card.deal`, `action.denied`, the seven `score.magnitude.*` bands, `round.start`, `round.cleared`, `round.failed`, `shop.open`, `run.lost`, `ui.click`, `ui.hover`, `ui.back`, `hand.reorder` and `reward.coin` (2 takes).

### Registered and played, but silent: no audio yet (16)

| Id                                                              | Played from                            | Note                                                               |
| --------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `shop.buy`                                                      | run-controller                         | Every purchase is silent. The table above still says planned.      |
| `shop.stock.toss`, `shop.stock.land`                            | shop-view                              | The shop's entrance animation is silent                            |
| `shop.stock.burn`                                               | run-controller                         | Unbought stock burning on leaving is silent                        |
| `block.destroyed`                                               | game-run, run-controller               | Destruction is silent; the table above lists it as `block.destroy` |
| `passive.coins`, `passive.granted`                              | play-presenter                         |                                                                    |
| `passive.activate.scoring`, `.economy`, `.effect`, `.retrigger` | passive-categories (category defaults) | Every passive activation is silent                                 |
| `material.activate.wood`, `.gold`, `.steel`, `.prismatic`       | materials (activation data)            | Tracked by #212                                                    |
| `view.zoom`                                                     | audio-service                          |                                                                    |
| `attract.card.bonk`                                             | attract-scene                          | Attract sequence only                                              |
| `ui.screenshot`                                                 | screenshot                             |                                                                    |

### Registered with audio, but never played (stale: 2)

- **`score.line` and `score.big`:** generated, but nothing plays them since the `score.magnitude` bands replaced them (#1). Either retire them (delete the entries and their MP3s), or give `score.big` a new trigger such as a whole play crossing a threshold. Their rows in the "Scoring and rounds" table still read as live.

### Listed above, never registered (25)

These are rows marked planned in the tables above with no registry entry. Most wait on features that don't exist yet; the ones in **bold** describe things the game already does.

- **Exists in the game:**
  - **`coin.earn`** is covered in practice by `reward.coin`. Drop the planned row, or rename it.
  - **`coin.spend`** is covered by `shop.buy`.
  - **`shop.cannot_afford`:** a refused purchase plays `action.denied`, which is fine to keep. Drop the row, or register it.
  - **`deck.add_block`:** a bought card joining the deck (#143), currently silent apart from `shop.buy`.
  - **`shop.leave`:** leaving the shop plays only `ui.click`.
  - **`block.destroy`** is a duplicate of the registered `block.destroyed`; fix the table.
- **Waiting on features:**
  - scoring and modifiers: `score.hand.pair`, `score.hand.set`, `score.hand.five`, `score.hand.special`, `score.total.tick`, `score.target.near`, `plays.last`, `modifier.held.trigger`, `modifier.placed.trigger`, `score.add`, `score.multiply`, `effect.retrigger`, `hand.upgrade`;
  - bombs, bosses and the run: `block.explode`, `boss.intro`, `boss.rule.applied`, `run.won`;
  - optional polish: `board.rotate`, `card.inspect`.

### Actions with no sound of their own

These already happen in the game, but have no dedicated id:

- **Stage won:** entering the stage-won pop-up has only `round.cleared` when the target is reached, and nothing as the pop-up's rows appear.
- **Deck view:** opening the deck view (#175) plays `ui.click`; tapping a block inside it is silent.
- **Passives:** picking up a passive from the rack, and selling a passive, plays `reward.coin`, but there is no pickup sound.
- **Layout change (#119/#120):** changing it plays `ui.click`, which is fine and needs nothing new.

### Produced since the audit (#236)

- **Generated:** priority 1 is done. `shop.buy`, `shop.stock.toss`, `shop.stock.land`, `shop.stock.burn`, `block.destroyed`, and `passive.activate.scoring`, `.economy`, `.effect` and `.retrigger` now have generated audio. So do the nine gameplay `material.attach.*` sounds from #232, which no longer fall back to `card.attach`.
- **Loudness:** takes that came back quiet were peak-normalised offline with ffmpeg to about −1 dB. These were wood, terracotta, ice and crystal attach, and the scoring, economy and effect activations. All committed takes now peak between −3 dB and 0 dB.
- **Still pending:** each take needs to be auditioned by ear in `/sfx.html`, and the remaining priorities 2–5 are still open.

### Recommendations, in priority order

1. **Generate audio for the silent sounds the player meets every run:** `shop.buy`, `shop.stock.toss` and `shop.stock.land` (the shop's entrance), `shop.stock.burn`, `block.destroyed`, and the four `passive.activate.*` categories. They are already wired up, so this is only `npm run sfx` with prompts. Most have no `prompt` yet.
2. **Retire or repurpose `score.line` and `score.big`,** and fix the table rows (`block.destroy` → `block.destroyed`, `shop.buy` → registered).
3. **Fold duplicate plans into what exists:** `coin.earn` → `reward.coin`, `coin.spend` → `shop.buy`, `shop.cannot_afford` → `action.denied`.
4. **New ids for existing actions:** `shop.leave`, `deck.add_block` (or let `shop.buy` cover it), `passive.pickup`, and a stage-won reward-row tick.
5. **Families (#235):** the passive activations (`passive.coins` by amount) and future `score.total.tick` are natural magnitude families. Material attachment (#232) is grouped by material data instead, and needs no family.

#236 is the follow-up that produces the missing effects.

## Open questions

1. **Scoring and round sounds:** after a play, each line that scores is presented from lowest to highest score, about a third of a second apart. Its row is tinted gold and its `score.magnitude.*` sound plays, chosen by that line's points. `round.cleared` or `round.failed` follows the last line. `score.line` and `score.big` are generated but no longer played; remove them if the magnitude family covers every need.
2. **Volume and muting:** master volume, a mute toggle, and whether to respect the system's reduced-motion setting by playing fewer or quieter effects.
3. **Music:** music is separate from this SFX registry. Seamless, bar-aligned loops live in `music/loops/` and are auditioned in the development-only `/music.html` room, which crossfades between them on the beat (see `music/README.md`). Decide which loops the game uses and wire them in.
4. **Review:** listen to the generated takes and regenerate any that miss with a revised prompt (`npm run sfx -- <id> --force`).
