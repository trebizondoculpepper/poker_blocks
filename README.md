# Poker Blocks

A new browser puzzle game project. The current Hello World screen includes a Three.js scene to confirm the rendering pipeline; game rules and interaction are still to be designed.

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
npm run dev
```

Open the URL printed by Vite+. Other commands:

```sh
npm run check   # format, lint, and type-check
npm test        # run tests when added
npm run build   # production build in dist/
npm run preview # inspect the production build
```

With a global Vite+ CLI, use `vp dev`, `vp check`, `vp test`, and `vp build`; `vp run <script>` runs package scripts. Without it, `npm run ...` uses the project-local CLI.

## References

Sibling projects live one directory up. `../shrew_farmer` and `../no_touch` are the closest Vite+/Three.js game references; `../simulation_of_boring_things` has a larger game architecture. Use them for patterns when useful, while keeping this game's requirements independent.
