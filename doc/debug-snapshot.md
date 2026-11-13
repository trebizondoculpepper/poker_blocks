# Read-only debug snapshot

Target design, owner request #987. Not yet implemented.

## Purpose

Add a developer-console command to copy useful diagnostics when the game reaches an odd state. Motivating bug: title blocks remain after quit → new game (#985). A normal model save alone may miss presentation leaks.

Proposed command: `debug snapshot` (final parser syntax should follow existing console conventions).

Capture schema/build identity, opaque current mode and scene-stack handles, model cards/ownership and passive-instance state, scheduler pending/active/scope summaries, mounted title/view ownership, and bounded recent actions/errors. Missing providers must report unavailable instead of claiming empty/healthy. Diagnostics must not mutate gameplay, draw RNG, tick the scheduler, replay actions, or serialize callbacks/GPU resources. No arbitrary browser storage, credentials or full sensitive URLs. Clipboard only on explicit user command; provide selectable-text/download fallback if denied.

Architecture: registered read-only diagnostic providers, scoped/disposed with their owning services; narrow ConsoleHost adapter. No special-case room/material/title identity checks or gameplay logic in main. Bound depth, count and bytes; report truncation. Snapshot is diagnostic evidence, not a save/import or guaranteed reproduction artifact. Source audit: src/console/commands.ts ConsoleHost/ConsoleCommand and src/console-host.ts consoleHostFor establish existing command/host boundary; src/scenes.ts and src/visual-events/scheduler.ts own scene and presentation state respectively.

Acceptance: reproduce #985 and compare scene-stack versus mounted-view summaries; show copy success/failure, unavailable providers and truncation; prove model/RNG and timing remain unchanged. Split collection and command/UI if implementer finds scope oversized. No implementation before merged design.

## Evidence, trade-offs and limits

Existing command/host boundaries support adding one registered command rather than special-casing a game mode. A model-only export cannot diagnose a presentation resource that outlives its scene; independent view and scene summaries are therefore required. Registered bounded providers keep resource ownership local and avoid exposing live mutable services. This has not yet reproduced #985, and reports do not promise deterministic replay. Unavailable or truncated evidence must stay explicit. The command is development-only and must remain outside production tool composition.
