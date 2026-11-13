# GitHub Triage: global install

GitHub Triage is developed in the standalone [github_triage repository](https://github.com/trebizondoculpepper/github_triage). Its [CLI contract](https://github.com/trebizondoculpepper/github_triage/blob/main/doc/github-triage-cli.md), [dependency design](https://github.com/trebizondoculpepper/github_triage/blob/main/doc/issue-dependencies.md) and issues belong there. This game repository consumes the tool; it owns no collector, workflow-rule, formatter or CLI test implementation.

## Global installation and launch

The owner chose a **global install** (superseding the #724 project dependency). The tool is a developer-only briefing command: the game, its build, its tests and CI never run it, so pinning it in this repository's `package.json` and `package-lock.json` bought nothing and cost a lockfile PR for every upstream change. poker_blocks has no `github-triage` dependency and no `triage` npm script.

Install it once per machine, from the standalone project's `main` branch:

```sh
npm install -g git+https://github.com/trebizondoculpepper/github_triage.git#main
```

Its package declares the `github-triage` command. Run it from the poker_blocks checkout:

```sh
github-triage --help
github-triage --json
github-triage --issue 432
github-triage deps 675 --tree
```

The working directory stays the game checkout, so the tool's authenticated `gh repo view` resolves poker_blocks. The standalone project owns runtime requirements, features, lifecycle and tests; use `--help` for current flags. If the command is missing, install it; do not fall back to a sibling or vendored implementation.

## Updates, evidence and limits

Update by reinstalling with the same command. An update changes no file in this repository, so it needs no PR. Each agent's machine updates independently, so a briefing should say which upstream commit it ran (`npm ls -g github-triage`, or the commit shown by `git ls-remote https://github.com/trebizondoculpepper/github_triage.git main` at install time). A developer working on the tool itself may `npm link` their checkout instead; the command is then that checkout.

Trade-off accepted: agents may briefly run different revisions, in exchange for no lockfile churn. Reproducibility for the game is unaffected, since nothing in the build or CI depends on the tool.

Evidence (2026-11-13): the standalone `package.json` declares `"bin": { "github-triage": "src/cli.js" }`; `grep` of `.github/workflows` finds no use of triage; on a machine with the command linked globally, `github-triage --help` run from the poker_blocks checkout printed the usual help. The implementation PR removes the dependency and script, and updates the triage skill's update step.
