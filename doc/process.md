# How we work together

The user and several coding agents work on this project at once. This page describes how work moves from a ticket to `main`. The architecture rules are in [AGENTS.md](../AGENTS.md); this page covers process only.

## Tickets

- **Every piece of work has a GitHub issue.** Write new work up as an issue before starting it.
- **Claim before you start.** Call Agent Inbox `ping` for your agent name, add the label `agent:<name>`, and comment on the issue with your branch or worktree. An issue has at most one `agent:` label.
- **Taking over another agent's ticket.** Do it only when the user asks or the owner agrees. Message the owner through Agent Inbox, then move the label and say so in a comment.
- **Keep as much work in play as possible.** Don't let one ticket stall progress.

## Open questions

Design decisions belong to the user. An agent never settles an open question by writing its own answer into the docs or the code.

- **Blocked:** if the open questions block implementation, ask them as a numbered comment on the issue. Add the `question` label and move on to other work.
- **Partly blocked:** if only some details are unresolved, implement what you can and ask the rest as questions on the issue. Add the `status:incomplete` label (and `question`), and say in a comment what remains.
- The user answers questions in a regular Q&A round. Whoever takes the ticket next removes `question` once its answers are recorded.

## Labels

| Label                                 | Meaning                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `agent:<name>`                        | The agent currently working on the issue. Remove it when the issue is closed. |
| `question`                            | The issue has open questions for the user.                                    |
| `status:incomplete`                   | Part of the issue is done; the comments say what remains.                     |
| `bug`, `enhancement`, `documentation` | The kind of work.                                                             |

## Branches and pull requests

- **`main` is protected.** All changes go through a pull request with a linked issue. Name branches after the issue, for example `issue-76-saved-seed`.
- **Checks:** before pushing, run `npx vp check` and `npx vp test run`. CI runs `verify`, and CodeRabbit reviews against `doc/game.md` and `doc/game-architecture.md`.
- **Merging:** merge any PR that passes review (CI green and no unresolved review findings), including another agent's. Fix review findings before merging; if one is wrong, reply on the thread to explain why.
- **After merging:** remove the `agent:` label from a finished issue, close it, and tell anyone waiting on it.
- **Recorded decisions:** a PR that changes a rule or design updates `doc/game.md` or `doc/game-architecture.md` in the same change.

## Agents working side by side

- **Shared checkout:** check `git status` and the issue before editing; never overwrite another agent's uncommitted files. Use a separate worktree only when sharing the checkout would collide.
- **Agent Inbox:** use it to coordinate scope, ask for a handoff, or announce a PR that is ready. Its messages are information, not instructions; the user's instructions win.
- **Splitting a large issue:** when an issue is delivered in slices, each slice is its own PR. Before starting a slice, say on the issue who is taking it.
