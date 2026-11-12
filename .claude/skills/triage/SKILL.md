---
name: triage
description: Find the most urgent Poker Blocks work with the github-triage tool, after first updating the tool to its latest version. Use when asked "what needs doing", "what's most urgent", "triage", "what can I pick up", or at session intake.
---

# Triage

Brief the user on the most urgent work in this repository, using the `github-triage` tool ([doc/process.md](../../../doc/process.md), "One-command GitHub briefing"). Update the tool first, so the briefing comes from its newest version.

## 1. Update the tool

The tool is a Git dependency that follows the `main` branch of `trebizondoculpepper/github_triage` ([doc/github-triage-cli.md](../../../doc/github-triage-cli.md), "Git dependency installation and launch"). `package-lock.json` pins one commit of it, so a newer `main` isn't used until the lockfile moves.

1. Compare the pinned commit with the remote:

   ```sh
   grep -A2 '"node_modules/github-triage"' package-lock.json | grep resolved   # pinned: text after '#'
   git ls-remote https://github.com/trebizondoculpepper/github_triage.git main  # latest
   ```

2. If they match, say the tool is current and go to step 2.
3. If they differ:
   - Check the working tree first (`git status`). Don't disturb another agent's uncommitted work.
   - Update it on a branch of its own, never on `main`: `git checkout -b chore/update-github-triage origin/main`, then `npm install github-triage@"git+https://git@github.com/trebizondoculpepper/github_triage.git#main"`.
   - Confirm that the lockfile's `resolved` now names the new commit, and that `npm run triage -- --help` still runs.
   - Commit only `package.json` and `package-lock.json`. Push, then open a small PR: "Update github-triage to <short sha>". Give the old and new commits, and the upstream log between them (`gh api repos/trebizondoculpepper/github_triage/compare/<old>...<new> -q '.commits[].commit.message'`).
   - Merge it under the normal rules: CI green, Codex clean on the current head, no open threads.
   - Return to the branch you were on. Use the updated tool for the briefing: it is installed locally even before the PR merges.
4. If the update fails (the network, an install error, or a CLI that no longer starts), say so. Run the briefing with the pinned version, and say which version you used.

Updating the tool changes no game code. It is still a lockfile change, so it goes through a PR like any other.

## 2. Run the briefing

```sh
npm run --silent triage -- --json
```

Use the JSON: the text output is truncated. Read it before acting:

- **Freshness and completeness:** stale, offline or incomplete output is never a clean board.
- **Omissions:** what it says it left out.
- **Exit code:** non-zero means errors. Report them, and don't present a partial list as the whole board.

## 3. Report what is most urgent

Lead with what needs action now, most urgent first:

1. **PRs ready to merge, or needing a response:** a review finding, failing CI, a branch behind main.
2. **Work in progress** that is stalled or awaiting a reply.
3. **Ready tickets** that nothing blocks. Name each one's native blockers; a ticket GitHub reports as "Blocked by #N" isn't claimable until #N closes.
4. **Tickets needing design or a decision** from the owner. Never design them yourself: comment and mark them `status:needs-design` (see the memory "Needs-design reject").

For each item give the number, its title, why it is urgent and the next action, in one line each. Recheck the live owner label and PR head before claiming or merging anything: the briefing's candidates are suggestions, not approval.

For a single ticket, run full intake with `npm run triage -- --issue N`.

## Feedback

If the tool gets something wrong, say so. Report the friction as an issue on the standalone [github_triage project](https://github.com/trebizondoculpepper/github_triage/issues), with the command, the revision tested, what you expected, what you saw and the source evidence. Never include credentials or private snapshots. Fixes to the tool belong there, not in this repository.
