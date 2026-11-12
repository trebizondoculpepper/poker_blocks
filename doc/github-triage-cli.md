# GitHub Triage: external source checkout

GitHub Triage is developed in the standalone [github_triage repository](https://github.com/trebizondoculpepper/github_triage). Its [CLI contract](https://github.com/trebizondoculpepper/github_triage/blob/main/doc/github-triage-cli.md), [dependency design](https://github.com/trebizondoculpepper/github_triage/blob/main/doc/issue-dependencies.md) and issues belong there. This game repository consumes the tool; it owns no collector, workflow-rule, formatter or CLI test implementation.

## Source installation and launch (#713)

The owner selected the sibling source checkout, currently `/Users/salimfadhley/workspace/github_triage`. After the consumer implementation merges, the existing command is wired as:

```json
"triage": "node ../github_triage/src/cli.js"
```

Run it from poker_blocks:

```sh
npm run triage -- --help
npm run --silent triage -- --json
npm run triage -- --issue 432
npm run triage -- deps 675 --tree
```

Node launches the sibling CLI directly; no build, SDK, vendored copy or globally installed executable is required. npm forwards arguments and preserves the game checkout as the working directory, so the tool's authenticated `gh repo view` resolves poker_blocks. The standalone project owns its runtime requirements, feature availability, lifecycle and testing. Use `--help` to inspect its current flags. If the sibling checkout is missing, launch fails visibly; do not fall back to stale embedded code. The game build and CI do not invoke this optional developer command.

## Evidence and limits

Source audit: standalone `package.json` declares `src/cli.js` as its CLI entry, and `src/github.js` resolves the repository through `gh repo view` with the inherited working directory. Direct `node /Users/salimfadhley/workspace/github_triage/src/cli.js --help` succeeds. The consumer PR must verify help and a live full-ticket JSON invocation from the game checkout.

Direct source launch follows the owner's explicit installation choice. Keeping another implementation here would drift from standalone development. A global npm source link is unnecessary and currently encounters the standalone entry-point guard's symlink/real-path mismatch, silently exiting without a report; that issue belongs to the standalone project. This consumer launch avoids that path. The sibling layout is a local-development assumption, not a published installation or version-pinning policy.

Briefings remain inspection evidence: recheck live ownership, PR head, required checks and review findings before acting. Missing evidence, offline snapshots and closed blockers are not approval. Game workflow labels and native dependency policy remain in [process.md](process.md) and [issue-dependencies.md](issue-dependencies.md).
