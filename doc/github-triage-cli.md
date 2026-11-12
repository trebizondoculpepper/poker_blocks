# Read-only GitHub action briefing CLI (#626)

## Purpose and ownership

`npm run triage` gives an LLM a single current briefing for this repository: suggested next actions, evidence, ready/unclaimed work, active owners, design/question/blocker context, PR checks/review findings, label inconsistencies and known dependency states. `--json` produces the same versioned structured information; `--issue N` includes the full issue body/comments and linked PR information for intake. This is a developer CLI under `scripts/triage/`, never imported into production. The user explicitly authorized implementation after this design merges.

The collector invokes the authenticated `gh api graphql` via argument arrays, without a shell. It does not handle/read/print tokens, request new credentials or send content to an LLM service. All GitHub operations are queries. No claim, comment, label edit, issue creation, review submission or merge occurs. This tool recommends inspection/action; it is not authority to bypass process, documentation-first or review requirements.

## Evidence and initial scope

Existing `doc/process.md` defines readiness labels, `agent:` ownership, dependencies and review/merge requirements. #626 records the owner's one-shot intake/triage request. Manual `gh issue list/view` and `gh pr list/checks` currently require many separate calls and interpretation. There is no repository triage utility at the source audit `3be61a8`.

A live GraphQL probe on 2026-11-12 confirmed repository issue/comment/label connections, issue `stateReason`, PR closing references, review threads, mergeability/review decision and head-commit status-check rollup/context fields. Reuse these factual API fields and paginate connections; no GitHub SDK or third-party summarization dependency is necessary. Stable registered analysis rules express workflow policy separately from retrieval/formatting, consistent with the project's no-special-cases rule.

The first implementation is one coherent read-only collector/action briefing, not an autonomous agent. Other human workflows or tracker integrations can follow separately. Deterministic hints never claim to reliably resolve natural-language questions or establish design approval.

## Inputs and commands

- `npm run triage` refreshes open issues and PRs and prints a compact text briefing, highest-priority suggested actions first. Repository defaults to `gh repo view` for the checkout; `--repo owner/name` overrides it.
- `--json` emits schema-versioned JSON without progress/debug noise on stdout.
- `--issue N` additionally fetches that issue even when closed and includes unabridged body/comments plus related open PR evidence; it never automatically claims it.
- `--since <ISO timestamp>` includes changed issues and PRs (including closed/merged) since that time. Without it, the briefing describes current state, not an invented “since yesterday”.
- `--checkpoint <path>` compares with the last successful checkpoint time and advances it only after a complete successful live report is produced. A missing checkpoint establishes a baseline explicitly; it is not a claim to have observed all history. Supplied `--since` is explicit and takes precedence.
- `--cache <path>` writes the successful fetched snapshot atomically. `--offline` requires an explicit cache path and labels its original fetch time/age and missing live verification. Never silently fall back to stale cache on an API error. Checkpoints do not advance from an offline or incomplete result.
- `--limit N` bounds displayed/listed actions per section (default 10); output includes total/omitted counts and stable issue/PR URLs. Full raw history is available through `--issue`, not silently guessed from a truncated summary. `--help` documents flags and exit behavior.

Default text should fit a useful intake response rather than dump every comment. JSON includes compact issue/PR context (body/latest-comment excerpts, source URLs, owners, labels, timestamps, docs links, dependency and PR relations), actions and warnings. Detail mode includes full issue history. Text truncation is marked; structured output names omitted context and a detail command. No critical action disappears without an omitted-count indicator. Raw snapshot caching is separate from this compact presentation schema.

## Collection and freshness

Capture repository, request start/fetch time and source endpoints; describe the fetch as a window, not an atomic GitHub snapshot. Fetch every page of open issues/PRs and their comments. Page nested labels, review threads, head checks and closing references or report explicit completeness warnings; unknown is never clean/passing. Review-thread comments may be represented by their linked first comment plus omitted count, but the thread's resolved/outdated state must be preserved. Query failure, permission failure or rate-limit exhaustion is a nonzero exit with a concise diagnostic; no empty-success result. Available rate-limit metadata belongs in JSON. Errors must not echo an environment/token or arbitrary request secrets.

For `--since`/checkpoints, fetch updated issue/PR connections in descending update order across all states until the cutoff; this includes closed/merged work, not just still-open items. An update timestamp indicates the object changed, not which label/comment changed. Report exact relabel/answer history only if actually observed; the initial version reports updated/current facts with evidence. Use server-provided cursors and never assume page order from issue number. Fixed text clipping is not evidence of an unanswered question.

Dependencies come from an explicit `Depends on #N` or cross-repository URL list in the issue body, not every issue reference. Support bullet lists in a clearly marked dependencies section. Resolve referenced issue/PR states, deduplicate lookups, preserve cross-repository scope and distinguish CLOSED/COMPLETED, CLOSED/NOT_PLANNED and MERGED PRs. An optional prerequisite, prose mention or linked epic is not automatically a blocker. Human-written ambiguity remains a warning. All declared blockers closed is a **candidate to verify**, not proof the required behavior was implemented or the architecture merged.

## Workflow analysis and next actions

Use a registry of named rule handlers over normalized facts and a declarative workflow policy (readiness labels, owner prefix and expected CI check names). The generic runner invokes handlers uniformly; do not add issue-number special cases, a table keyed by object identity, or a giant branch chain on status labels. Identity handles only locate evidence/relations. Each action has rule ID, priority, target URL, concise reason, suggested next step and evidence URLs. Multiple true findings remain visible; a blanket “merge” verdict never replaces failed or unknown checks.

Initial rules cover:

- open PRs with failed/pending/absent checks, conflicts/out-of-date state, review changes requested or unresolved review threads; clean/current verified PRs become **inspect and consider merge** candidates, never auto-merges;
- ready unclaimed issues, active claims and multiple-owner conflicts;
- unclaimed issues with missing/multiple readiness labels, and ready labels left on claimed work;
- blocked issues whose explicit prerequisites appear satisfied, or whose blocker explanation is absent; parked work remains deliberately parked, not pickup advice;
- needs-design/question/human-review labels and **candidate** question/review comments, including later reply context so a question mark is never declared unanswered just by regex;
- issue scope/dependency/documentation links for intake. Missing extracted docs links means “not found in this text”, not “architecture missing”.

The registry may emit heuristic findings only with an explicit uncertainty label. Semantic reconciliation of historical versus superseding answers remains the consuming LLM's job, with full linked history available. No special casing of named agents; an optional current-agent filter can compare supplied ownership configuration uniformly. CI conclusions and check names are interpreted through registered policy; CodeRabbit/Codex advisory findings still need inspection as described in process, and required `verify` cannot be inferred from some unrelated green job.

## Verification and rollout

First merge this document and the canonical architecture/process pointers, then implement in a separate PR. Tests must cover primary and nested pagination/completeness, declared versus incidental dependencies, cross-repository references, closed-unplanned versus merged status, missing/failed/pending head checks, unresolved threads, competing owners/readiness contradictions, question candidates with later replies, deterministic ordering, cache repo/schema mismatch/offline age, checkpoint failure safety and unknown/error reporting. Use injected gh query/clock/filesystem boundaries; tests must not need a GitHub credential. Run a real read-only report against this repository and inspect its suggested actions and full-ticket mode before delivery. No gameplay changes or generation keys are involved.
