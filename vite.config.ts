import { prepareWebsite } from "./scripts/prepare-website";
import { defineConfig } from "vite-plus";
import { version } from "./package.json";
import { buildVersion, gitIn } from "./scripts/versioning.ts";

/**
 * The build's version (#128): a release workflow passes its exact version in
 * `POKER_BLOCKS_VERSION`; every other build derives it from the commits since the last release.
 */
const appVersion =
  process.env.POKER_BLOCKS_VERSION || buildVersion(version, gitIn(import.meta.dirname));

/**
 * Two outputs (#1406; doc/game-website.md): the default build is the website (\`index.html\` at the
 * site root, into \`dist\`); \`vp build --mode game\` builds the game self-contained into \`dist/game\`,
 * its own page and assets, which is what the release zip and itch.io get. In development both are
 * served together: the website at \`/\`, the game at \`/game/\`.
 */
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins:
    mode === "game"
      ? []
      : [
          {
            name: "static-website-reference-pages",
            async buildStart() {
              await prepareWebsite(import.meta.dirname);
            },
            async configureServer() {
              await prepareWebsite(import.meta.dirname);
            },
          },
        ],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  ...(mode === "game"
    ? { root: "game", build: { outDir: "../dist/game", emptyOutDir: true } }
    : { build: { rollupOptions: { input: ["index.html", "materials.html", "modifiers.html"] } } }),
  fmt: {},
  // The pre-commit hook (.vite-hooks/pre-commit) formats and lints only the staged files.
  staged: {
    "*.{ts,tsx,js,mjs,json,md,css,html}": "vp check --fix",
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
}));
