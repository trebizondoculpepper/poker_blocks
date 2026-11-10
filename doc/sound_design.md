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

## Hand and placement (current game)

| Id                 | Plays when                                                          | Status    |
| ------------------ | ------------------------------------------------------------------- | --------- |
| `card.select`      | A card block is clicked and becomes selected                        | generated |
| `card.deselect`    | A selected block is clicked and becomes unselected                  | generated |
| `card.pickup`      | A drag starts on a hand block                                       | generated |
| `card.drag.snap`   | A valid attachment face comes under the dragged block               | generated |
| `card.drag.return` | A dragged block is dropped on nothing and returns to the hand       | generated |
| `card.place.fly`   | A placed block flies to its cell, growing to full size              | generated |
| `card.attach`      | A placed block lands and locks into its cell                        | generated |
| `discard.hover`    | A dragged block moves over the discard bin                          | generated |
| `card.discard`     | A block is dropped in the discard bin and dissolves                 | generated |
| `hand.reorder`     | A hand card or passive is dropped into a new position in its rack   | generated |
| `card.deal`        | A new block is drawn into the hand                                  | generated |
| `action.denied`    | An action is refused: no plays or discards left, or an invalid drop | generated |
| `board.rotate`     | The player drags to rotate the structure (quiet, optional)          | planned   |
| `card.inspect`     | The hover tooltip opens (very subtle, optional)                     | planned   |

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

## Modifiers and materials

| Id                        | Plays when                                                                        | Status  |
| ------------------------- | --------------------------------------------------------------------------------- | ------- |
| `modifier.held.trigger`   | A modifier block in the hand affects play                                         | planned |
| `modifier.placed.trigger` | A modifier block on the field affects play                                        | planned |
| `score.add`               | An effect adds to a score                                                         | planned |
| `score.multiply`          | An effect multiplies a score (must sound clearly different from `score.add`)      | planned |
| `effect.retrigger`        | An effect fires again                                                             | planned |
| `material.<name>`         | A card's material affects scoring (one per material, once materials are designed) | planned |
| `hand.upgrade`            | A hand type's base score is upgraded                                              | planned |
| `block.destroy`           | A block is removed from the field (if removal is adopted)                         | planned |
| `block.explode`           | An explosive block goes off (if adopted)                                          | planned |

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

| Id                  | Plays when                                                                   | Status                          |
| ------------------- | ---------------------------------------------------------------------------- | ------------------------------- |
| `attract.card.bonk` | A card in the title's attract sequence flies into the camera and bounces off | registered, audio not generated |

## Open questions

1. **Scoring and round sounds:** after a play, each line that scores is presented from lowest to highest score, about a third of a second apart. Its row is tinted gold and its `score.magnitude.*` sound plays, chosen by that line's points. `round.cleared` or `round.failed` follows the last line. `score.line` and `score.big` are generated but no longer played; remove them if the magnitude family covers every need.
2. **Volume and muting:** master volume, a mute toggle, and whether to respect the system's reduced-motion setting by playing fewer or quieter effects.
3. **Music:** music is separate from this SFX registry. Seamless, bar-aligned loops live in `music/loops/` and are auditioned in the development-only `/music.html` room, which crossfades between them on the beat (see `music/README.md`). Decide which loops the game uses and wire them in.
4. **Review:** listen to the generated takes and regenerate any that miss with a revised prompt (`npm run sfx -- <id> --force`).
