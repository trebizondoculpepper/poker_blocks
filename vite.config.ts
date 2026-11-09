import { defineConfig } from "vite-plus";
import { version } from "./package.json";
import { buildVersion, gitIn } from "./scripts/versioning.ts";

/**
 * The build's version (#128): a release workflow passes its exact version in
 * `POKER_BLOCKS_VERSION`; every other build derives it from the commits since the last release.
 */
const appVersion =
  process.env.POKER_BLOCKS_VERSION || buildVersion(version, gitIn(import.meta.dirname));

export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
