# GitHub Triage: npm Git dependency

GitHub Triage is developed in the standalone [github_triage repository](https://github.com/trebizondoculpepper/github_triage). Its [CLI contract](https://github.com/trebizondoculpepper/github_triage/blob/main/doc/github-triage-cli.md), [dependency design](https://github.com/trebizondoculpepper/github_triage/blob/main/doc/issue-dependencies.md) and issues belong there. This game repository consumes the tool; it owns no collector, workflow-rule, formatter or CLI test implementation.

## Git dependency installation and launch (#724)

The owner selected an npm URL dependency while the standalone tool is unreleased. Add `github-triage` to `devDependencies` using a public Git HTTPS URL tracking its `main` branch, and commit `package-lock.json`. The consumer script launches the installed source entry:

```json
"triage": "node node_modules/github-triage/src/cli.js"
```

The Git dependency follows `main`:

```text
git+https://git@github.com/trebizondoculpepper/github_triage.git#main
```

The literal `git` username is public and contains no credential; it preserves HTTPS in npm's resolved lockfile instead of npm normalizing this GitHub URL to SSH. No registry publication, local sibling checkout, global install or SSH key is required. Use normal `npm install` / `npm ci` with development dependencies. The dependency may run its upstream `prepare` lifecycle as permitted by the npm version's lifecycle policy; it is not imported into the game or built at runtime.

Run it from poker_blocks:

```sh
npm run triage -- --help
npm run --silent triage -- --json
npm run triage -- --issue 432
npm run triage -- deps 675 --tree
```

npm forwards arguments and preserves the game checkout as the working directory, so the tool's authenticated `gh repo view` resolves poker_blocks. The standalone project owns runtime requirements, feature availability, lifecycle and testing. Use `--help` for current flags. Missing development dependencies fail visibly; do not fall back to a sibling or vendored implementation. Game builds and tests do not invoke the optional developer command.

## Updates, evidence and limits

The owner selected branch tracking with **explicit updates**, rather than fetching on every execution. `package.json` follows `main`; `package-lock.json` records the last resolved commit so `npm ci` remains reproducible. Merely running the CLI or `npm ci` does not fetch a newer upstream commit.

Refresh to the latest `main` commit with:

```sh
npm update github-triage
npm run triage -- --help
```

Commit the updated lockfile through the normal PR/check process and smoke-test full-ticket JSON when updating. No pre-run updater is installed; offline cache behavior remains under the standalone CLI's control. Git fetching is a temporary distribution choice before release, not authorization to publish a package.

Source audit at `35bc593`: standalone `package.json` declares `src/cli.js` as its CLI entry and a `prepare` hook using Vite+; `src/github.js` uses `gh repo view` with the inherited working directory. Disposable normal npm installs verified Git URL installation and explicit installed-source execution. An explicit HTTPS URL with the public `git` username preserved HTTPS in the generated lockfile, while the same URL without it was normalized to `git+ssh` by npm 11.19.0. The implementation PR must also validate clean `npm ci` and the project's normal checks.

The upstream npm-bin entry-point symlink guard still exits silently ([github_triage#11](https://github.com/trebizondoculpepper/github_triage/issues/11)). Calling the installed JS entry with Node avoids that defect without copying or patching the tool here. Once upstream fixes and tests the package executable, a later dependency upgrade can simplify the script. Smoke tests check actual nonempty help/valid JSON, rather than accepting exit zero alone.

Briefings remain inspection evidence: recheck live ownership, PR head, required checks and review findings before acting. Missing evidence, offline snapshots and closed blockers are not approval. Game workflow labels and native dependency policy remain in [process.md](process.md) and [issue-dependencies.md](issue-dependencies.md).
