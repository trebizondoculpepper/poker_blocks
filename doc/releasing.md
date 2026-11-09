# Versions and releases

How the game is versioned and released (#127, #128). It follows The Pool's model, adapted to a protected `main`.

## Versions

- `package.json`'s version is the **last release**, starting at `0.0.0`.
- **Every build derives its patch:** that version plus the first-parent commits on `main` since the commit that last changed it. Each merged PR moves the patch on by one, and no build commits anything (`scripts/versioning.ts`). A checkout without history (a shallow clone) builds as `X.Y.Z-dev`.
- **A release moves the minor version** (0.3.x → 0.4.0). A major release happens only when the owner asks for one.
- The game reads its version from `appVersion` (`src/version.ts`), which the build defines.

## Making a release

1. On a clean `main`, level with `origin/main`, run `npm run release`. Use `npm run release -- major` only when the owner asks, or `-- 1.2.3` for an exact version.
2. It runs the checks and the build, then opens a **`Release vX.Y.Z` PR** that changes only `package.json` and the lockfile.
3. **Merge that PR.** `.github/workflows/release.yml` sees that the new version has no release yet. It builds the game at exactly that version and publishes the GitHub release `vX.Y.Z` with `poker-blocks-vX.Y.Z-web.zip` attached (the web build, `index.html` at its root) and generated notes.

If publishing fails, fix the cause and run `gh workflow run release.yml` to publish it again.

## itch.io (#130)

The same release also goes to itch.io: `release.yml` pushes the web build with butler to `trebizondoculpepper/poker-blocks:html5` (the project at <https://itch.io/game/edit/5330084>), versioned as the release.

- **The secret:** butler logs in with the **`BUTLER_API_KEY`** GitHub Actions secret, which the owner adds in the repository's settings (Settings → Secrets and variables → Actions) from itch.io's Account → API keys. Until it exists, the itch.io step is skipped with a warning and the GitHub release still publishes. Never commit the key; a test fails if a file in the repository assigns one.
- **Only releases publish:** the step runs only when a new release is being published, never on ordinary pushes.
- **Retrying itch.io alone:** if the upload fails after the GitHub release published, run `gh workflow run release.yml -f itch_only=true`. It rebuilds the current version and pushes it to itch.io without touching the GitHub release.
- **Page settings stay manual:** an upload doesn't change the page. The owner sets the HTML5 project to launch in fullscreen, and makes the page public when ready, on itch.io.

## Guardrail

CI runs `scripts/version-guard.ts` on every PR and push. Only a commit titled exactly `Release vX.Y.Z` may change `package.json`'s version, and only to X.Y.Z with both lockfile version fields matching. Anything else fails CI, so the version can't drift outside a release.
