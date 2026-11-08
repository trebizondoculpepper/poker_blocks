# Poker Blocks

A browser puzzle game project. The current demo draws six unique cards: one large cube in play and five smaller cubes in a hand at the bottom. Each cube shows its card's rank and suit on every face. Hover over any card to inspect it; click or tap to toggle selection. Drag a hand cube onto an exposed face of any cube in play to attach it, or into the pixel art discard area to discard it. Placement eases into the structure over one second; discards dissolve away with a Perlin noise effect. After one second, the dealer refills the empty hand slot with a card that materializes using the same effect. The left overlay shows score, target, moves, and discards; the right overlay shows cards left in the deck. The placed structure gently wobbles around its center of gravity, and you can drag it to rotate it horizontally and vertically. The camera eases back to fit the growing structure while the hand stays fixed. Reload to deal again. More game rules are still to be designed.

The agreed game principles and open architecture questions are recorded in [doc/game-architecture.md](doc/game-architecture.md). Keep future project documents in `doc/`.

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

The script installs dependencies if needed, then starts the dev server on all network interfaces. Extra arguments go to Vite+ (for example, `./dev-server.sh --port 5174`). Open the URL printed by Vite+. Other commands:

```sh
npm run check   # format, lint, and type-check
npm test        # run tests when added
npm run build   # production build in dist/
npm run preview # inspect the production build
```

With a global Vite+ CLI, use `vp dev`, `vp check`, `vp test`, and `vp build`; `vp run <script>` runs package scripts. Without it, `npm run ...` uses the project-local CLI.

## References

Sibling projects live one directory up. `../shrew_farmer` and `../no_touch` are the closest Vite+/Three.js game references; `../simulation_of_boring_things` has a larger game architecture. Use them for patterns when useful, while keeping this game's requirements independent.
