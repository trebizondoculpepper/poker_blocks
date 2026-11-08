# Agent guide

Instructions for coding agents working in this repository. Project documents live in `doc/`; the game rules are in [doc/game.md](doc/game.md).

## Every action has a sound

Each player action and notable game event plays a sound effect by id.

When you add or change an action:

1. Find a fitting entry in [`src/audio/sfx-registry.ts`](src/audio/sfx-registry.ts), or add one. A new entry needs only an `id` (lowercase and dotted, e.g. `shop.buy`) and a `trigger` (one sentence saying when it plays). Add a `prompt` only if one comes easily.
2. Call `playSfx("<id>")` from [`src/audio/sfx.ts`](src/audio/sfx.ts) at the moment the action happens. The id is type-checked against the registry.

Do **not** generate audio or call ElevenLabs. A sound with no audio file plays silently. The person maintaining the project writes the missing prompts and generates audio in a batch (`npm run sfx -- --list` shows what is pending). Reuse an existing id when the action should sound the same, for example `action.denied` for any refused action.

See [doc/sound_design.md](doc/sound_design.md) for the full sound list and approach.
