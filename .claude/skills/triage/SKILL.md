---
name: triage
description: Brief the most urgent Poker Blocks work for a role (implementer, designer or owner) with the github-triage tool, after first updating the tool to its latest version. Use when asked "what needs doing", "what's most urgent", "triage", "what can I pick up", or at session intake.
---

# Triage

Brief the user on the most urgent work in this repository, using the `github-triage` tool ([doc/process.md](../../../doc/process.md), "One-command GitHub briefing"). Update the tool first, so the briefing comes from its newest version.

## 1. Update the tool

The tool is installed globally as the `github-triage` command, from the latest npm release of `@trebizondoculpepper/github-triage` ([doc/github-triage-cli.md](../../../doc/github-triage-cli.md), "Global installation and launch"). Nothing in this repository pins it, so an update needs no PR.

1. Check how it is installed: `npm ls -g @trebizondoculpepper/github-triage`. If it points at a local checkout (`-> …`), a developer has `npm link`ed their own copy: leave it alone, say so, and use it as it is.
2. Otherwise reinstall the latest release, noting the version you get:

   ```sh
   npm install -g @trebizondoculpepper/github-triage
   npm ls -g @trebizondoculpepper/github-triage
   github-triage --help
   ```

   Never install from the Git URL: it leaves a broken link and no command (doc/github-triage-cli.md explains why). If `npm ls -g` shows a link into `~/.npm/_cacache/tmp`, an earlier Git install broke it: `npm uninstall -g @trebizondoculpepper/github-triage`, then install as above.

3. If the install fails or the command no longer starts, say so. If it doesn't start at all, there is no briefing: report it instead of improvising one.

Name the version (or the linked checkout) at the top of the briefing.

## 2. Run the briefing

```sh
github-triage --json
```

Use the JSON: the text output is truncated. Read it before acting:

- **Freshness and completeness:** stale, offline or incomplete output is never a clean board.
- **Omissions:** what it says it left out.
- **Exit code:** non-zero means errors. Report them, and don't present a partial list as the whole board.

## 3. Brief for a role

The skill takes a role argument: `/triage implementer`, `/triage designer` or `/triage owner`. With no argument, use the caller's role: the implementing agent is the **implementer**, and the design agent (the other LLM) is the **designer**. The **owner** briefing is written by the designer, for the human owner. Every briefing leads with the most urgent item and gives each item in one line: number, title, why it matters now, and the next action.

### Implementer: what can I do now to advance the project?

Only work the implementer can start or finish right now, without anyone else:

1. **PRs to finish:** ready to merge, a review finding to answer, failing CI, a branch behind main. Finishing beats starting.
2. **Work in progress:** your own claimed tickets that are stalled.
3. **Tickets to pick up:** `status:ready`, no open native blocker ("Blocked by #N" means it waits until #N closes), and no other agent's owner label. Prefer the one that unblocks the most other tickets.
4. **Unclaimed PRs** you could take over, after checking with their owner.

Leave out anything that needs design or an owner decision. For those, the implementer's only action is to make sure the ticket says what it needs: mark it `status:needs-design` with a comment, and never design it yourself (see the memory "Needs-design reject").

### Designer: what must I write up or clarify to unblock the implementer?

Rank by how much implementation each item would unblock:

1. **`status:needs-design` tickets:** what the design must cover, and which documents (doc/game.md, doc/game-architecture.md, doc/presentation-contracts.md and so on) to update in a documentation PR, merged first.
2. **Open questions** that implementers posted on tickets or PRs.
3. **Contradictions** an implementation exposed between the code and the documents, or between documents.
4. **Ready tickets** whose design is thin enough that an implementer would have to guess.

For each, say what is missing, and whether the designer can resolve it from the documents and evidence or needs the owner (if so, it belongs in the owner briefing).

### Owner: what must the owner decide to unblock the most work?

Written by the designer, for the human owner. Include only the decisions that neither agent may make: game rules, visual or audio taste, priorities, scope and trade-offs.

- Order the questions by how many tickets each answer would unblock, and name those tickets.
- Make each question one the owner can answer quickly: give the options, the designer's recommendation, and what follows from each answer.
- Ask them one at a time, most valuable first, in line with the owner's one-question-at-a-time rule. Don't send the whole list at once.
- Leave out anything the designer can settle from existing documents or evidence.

### Every role

Recheck the live owner label and PR head before claiming or merging anything: the briefing's candidates are suggestions, not approval. For a single ticket, run full intake with `github-triage --issue N`.

## Feedback

If the tool gets something wrong, say so. Report the friction as an issue on the standalone [github_triage project](https://github.com/trebizondoculpepper/github_triage/issues), with the command, the revision tested, what you expected, what you saw and the source evidence. Never include credentials or private snapshots. Fixes to the tool belong there, not in this repository.
