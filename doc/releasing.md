# Versions and releases

How the game is versioned and released (#127, #128). It works like The Pool: a release is a push, and the release workflow does the rest. Because `main` here is protected, the push goes to a separate, unprotected `release` branch that only ever follows `main`.

## Versions

- **A release is a `vX.Y.Z` tag**, made by the release workflow. `package.json`'s version (0.2.0) no longer changes; it is only the base for builds before the first tag.
- **Every build derives its patch:** the last release tag plus the first-parent commits on `main` since it. Each merged PR moves the patch on by one, and no build commits anything (`scripts/versioning.ts`). A checkout without history (a shallow clone) builds as `X.Y.Z-dev`.
- **A release moves the minor version** (0.3.x → 0.4.0). A major release happens only when the owner asks for one.
- The game reads its version from `appVersion` (`src/version.ts`), which the build defines.

## Making a release

When the owner says "make a release":

1. Run `npm run release`. It pushes `origin/main` to the `release` branch (a fast-forward; nothing else is ever committed there).
2. That push runs `.github/workflows/release.yml`. It checks the commit is on `main`, runs the checks, builds the game at the next minor version, and publishes the GitHub release `vX.Y.Z` on that commit (which makes the tag) with `poker-blocks-vX.Y.Z-web.zip` attached (the web build, `index.html` at its root) and generated notes. Then it pushes the same build to itch.io.

For a major release (only when the owner asks), run `npm run release -- major`; for an exact version, `npm run release -- 1.2.3`. These run the same workflow by hand on `main` with that level instead of pushing. Pushing a commit that is already released does nothing.

If publishing fails, fix the cause and run `gh workflow run release.yml --ref release`.

## itch.io (#130)

The same release also goes to itch.io: `release.yml` pushes the web build with butler to `trebizondoculpepper/poker-blocks:html5` (the project at <https://itch.io/game/edit/5330084>), versioned as the release.

- **The secret:** butler logs in with the **`BUTLER_API_KEY`** GitHub Actions secret, which the owner adds in the repository's settings (Settings → Secrets and variables → Actions) from itch.io's Account → API keys. Until it exists, the itch.io step is skipped with a warning and the GitHub release still publishes. Never commit the key; a test fails if a file in the repository assigns one.
- **Only releases publish:** the step runs only in a release, never on ordinary pushes to `main`.
- **Retrying itch.io alone:** if the upload fails after the GitHub release published, run `gh workflow run release.yml -f itch_only=true`. It rebuilds the last release tag and pushes it to itch.io without touching the GitHub release.
- **Page settings stay manual:** an upload doesn't change the page. The owner sets the HTML5 project to launch in fullscreen, and makes the page public when ready, on itch.io.

## Guardrail

CI runs `scripts/version-guard.ts` on every PR and push, so `package.json`'s version can't drift: no ordinary commit may change it. Releases no longer change it at all; their version lives in the tag.
