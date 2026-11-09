# Poker Blocks

A browser puzzle game project. The page opens on a title screen with Continue (resume the automatically saved run; greyed out, with "There is no game in progress." on hover, when there is none), New game and Settings (volume, mute, sound effects and music on/off, motion, shadows). The title panel's footer shows the build version, with links to the source code and the bug-report form; the bug link is also on the pause menu. Escape, or the ⚙ button, opens the pause menu (Resume, Settings, Quit to title) on the title screen or during play; the music is muffled while it is open and thinned while Settings is open. The structure floats above a green baize table in a dim card room, casting shadows on the cloth. In a stage, the field starts empty and the first card you drag up becomes the centre block. Six card cubes are dealt into a hand at the bottom. Each cube shows its card's rank and suit on every face. Hover over any card to inspect it; click or tap a hand card to toggle selection. Placed blocks remain inspectable but cannot be selected. Drag a hand cube onto an exposed face of any cube in play to attach it, or into the pixel art discard area to discard it. Placement eases into the structure over one second; discards dissolve away with a Perlin noise effect. After one second, the dealer refills the empty hand slot with a card that materializes using the same effect. The left overlay shows score, target, moves, and discards; the right overlay shows cards left in the deck. The placed structure gently wobbles around its center of gravity, and you can drag it to rotate it horizontally and vertically. The camera eases back to fit the growing structure while the hand stays fixed. Reload to deal again. More game rules are still to be designed.

On a touch screen, tap a block to select it, drag a hand block onto the structure or the Discard target, drag the structure with one finger to turn it, and press and hold any block to read its description.

Use the mouse wheel, trackpad scroll, or a two-finger pinch on the game canvas to zoom the playing field and table. The hand and HUD stay at the same screen size. Automatic framing after placement keeps your chosen zoom.

Press **Command-Shift-K** on Mac or **Control-Shift-K** elsewhere to capture the whole game window, including the hand and overlays, in a 3840 × 2160 PNG. The screenshot copies to the clipboard; if the browser cannot copy images, it downloads a PNG and offers a Save button. A window with a different aspect ratio is fitted inside the 4K image without cropping.

The rules of the game being designed are in [doc/game.md](doc/game.md), with canonical terms in [doc/terms.md](doc/terms.md). The agreed game principles and open architecture questions are recorded in [doc/game-architecture.md](doc/game-architecture.md). Sound effects are listed in [doc/sound_design.md](doc/sound_design.md). Every remaining special case in the code, with the ticket that removes it, is mapped in [doc/special-cases-audit.md](doc/special-cases-audit.md). Keep future project documents in `doc/`.

## Materials dev mode

Open [`?mode=dev0`](https://trebizondoculpepper.github.io/poker_blocks/?mode=dev0) (`?mode=dev` and the older `?room=` links still work) to play the normal game with the deck randomized across paper, wood, steel, prismatic crystal, gold, terracotta, ice, meat, and fire. Wood has different end-grain faces; jelly is deferred. Each new dev game reshuffles the material assignments, while Continue restores the same assignments. The dev mode has its own save, so it does not replace a normal run. Wood, steel and prismatic crystal change the score of a line they contribute to: wood adds 1 to the card's value, steel multiplies the line by 1.25, and prismatic crystal raises it to the power 1.1. The other materials have no gameplay effect yet.

Open [`?mode=dev1`](https://trebizondoculpepper.github.io/poker_blocks/?mode=dev1), the materials mode, to judge the substances side by side: it skips the title and opens on a small structure with one block of every material, each attached to a random free face of the others. Rotate it by dragging the table and hover a block to name its material. Every reload (or New game) builds a new structure; the hand works as in dev0, so more blocks can be attached. dev1 is a sandbox for endless play: no win or lose, and unlimited plays and discards (shown as ∞). Music starts wound down.

Open [`?mode=dev2`](https://trebizondoculpepper.github.io/poker_blocks/?mode=dev2) to try passives. A fresh run starts with two distinct active passives in the top rack, drawn at random (for example ×2, which doubles scored lines). This mode also has endless plays and discards, and it resumes its separate saved run on reload.

## Sound effects

Sound effects are defined in `src/audio/sfx-registry.ts` and generated once, locally, with the ElevenLabs sound-effects API. The resulting files are committed in `src/assets/sfx/`, so builds never need an API key. Every action plays a sound by id. A new registry entry plays silently until its audio is generated (see [AGENTS.md](AGENTS.md)). To generate audio for new entries, run:

```sh
npm run sfx -- --list                           # show what is pending
ELEVENLABS_API_KEY=... npm run sfx              # generate missing files only
ELEVENLABS_API_KEY=... npm run sfx -- <id> --force  # regenerate one sound
```

To hear them all, run the dev server and open `/sfx.html` (the listening room).

## Music room

Open `/music.html` on the dev server to audition the music loops in `music/loops/` (and, in a dev checkout, the git-ignored auditions). Pick a track to start and another to crossfade: the switch waits for the next bar, enters the new loop on the same beat, glides the tempo between the two like a tape machine, and fades logarithmically (evenly in decibels). See [music/README.md](music/README.md). This development page is not part of the production build.

## Stack

- Vite+ 1.5, including Vite, Vitest, Oxlint, and Oxfmt
- TypeScript 7 and Three.js 0.187
- npm lockfile and GitHub Actions CI

## GitHub Pages

Pushes to `main` run checks, tests, and a production build. A successful build is published to GitHub Pages at `https://trebizondoculpepper.github.io/poker_blocks/`. Pull requests run the same checks without deploying. The repository's Pages source is configured for GitHub Actions.

## Develop

Use Node.js 26 or a supported recent Node.js release.

```sh
npm install
./dev-server.sh
```

The script installs dependencies if needed, then starts the dev server on all network interfaces and prints two addresses: one for this computer and one for a phone on the same Wi-Fi or LAN. Extra arguments go to Vite+ (for example, `./dev-server.sh --port 5174`); the printed phone address follows a custom port. The script uses a fixed port, so if that port is taken it stops with "Port … is already in use" instead of silently moving to another port.

### Playing on a phone

1. Connect the phone to the same Wi-Fi network as the computer.
2. Run `./dev-server.sh` and open the printed `Phone (same Wi-Fi/LAN)` address in the phone's browser.
3. Editing a source file reloads the page on the phone, as it does on the computer.

If the phone cannot connect:

- **macOS firewall:** allow incoming connections for `node` when macOS asks, or in System Settings → Network → Firewall → Options.
- **Wrong address:** if the computer is on several networks (for example Ethernet and Wi-Fi), the Vite+ `Network:` lines list every address; try the one on the phone's network.
- **Guest or public Wi-Fi:** many guest networks isolate devices from each other. Use a home network or the phone's own hotspot.
- **VPN:** a VPN on the computer or phone can route local traffic away. Pause it, or allow local network access.
- **"Port … is already in use":** stop the other server or choose another port with `--port`.

The server is only reachable on the local network; do not forward its port to the internet. Reaching it from a different network (for example with a secure tunnel) is a separate setup.

Other commands:

```sh
npm run check   # format, lint, and type-check
npm test        # run tests when added
npm run build   # production build in dist/
npm run preview # inspect the production build
```

With a global Vite+ CLI, use `vp dev`, `vp check`, `vp test`, and `vp build`; `vp run <script>` runs package scripts. Without it, `npm run ...` uses the project-local CLI.

## References

Sibling projects live one directory up. `../shrew_farmer` and `../no_touch` are the closest Vite+/Three.js game references; `../simulation_of_boring_things` has a larger game architecture. Use them for patterns when useful, while keeping this game's requirements independent.

## Versions and releases

Each merged PR moves the build's patch version on; `npm run release` opens the PR for the next minor release, and merging it publishes a GitHub release with the web build. See [doc/releasing.md](doc/releasing.md).
