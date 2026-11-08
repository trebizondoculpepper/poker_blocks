# Agent guide

Instructions for coding agents working in this repository. Project documents live in `doc/`; the game rules are in [doc/game.md](doc/game.md).

## Every action has a sound

Each player action and notable game event plays a sound effect by id.

When you add or change an action:

1. Find a fitting entry in [`src/audio/sfx-registry.ts`](src/audio/sfx-registry.ts), or add one. A new entry needs only an `id` (lowercase and dotted, e.g. `shop.buy`) and a `trigger` (one sentence saying when it plays). Add a `prompt` only if one comes easily.
2. Call `playSfx("<id>")` from [`src/audio/sfx.ts`](src/audio/sfx.ts) at the moment the action happens. The id is type-checked against the registry.

All audio is **pre-generated** and committed as files under `src/assets/sfx/`. The game never generates or fetches sound at runtime, and neither the build nor CI needs an ElevenLabs key. To create audio, write the entry's `prompt` and run `npm run sfx -- <id>` (which calls ElevenLabs once, locally) when a task asks for it, then commit the MP3s. Otherwise registering the id is enough: a sound with no audio file plays silently, and `npm run sfx -- --list` shows what is pending. The `ELEVENLABS_API_KEY` is kept outside the project; never commit it. Reuse an existing id when the action should sound the same, for example `action.denied` for any refused action.

See [doc/sound_design.md](doc/sound_design.md) for the full sound list and approach.
