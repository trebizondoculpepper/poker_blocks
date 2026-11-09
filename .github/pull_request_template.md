## What and why

<!-- What this changes and the issue it closes. -->

## Design and architecture check

<!-- Link the relevant issue and design sections. Explain any intentional change to doc/game.md or doc/game-architecture.md; if neither needs changing, say why. -->

## Composition check (required, see AGENTS.md "No special cases")

- [ ] Adds no branch on a phase, scene, room, mode, screen, material, kind, type, dealer, name or id (no `=== "literal"`, no `switch`).
- [ ] Reads no trait as a flag (`if (traits.x)`, `traits.x ? a : b`); new behaviour lives in a trait, registry entry or configuration.
- [ ] Adds no game logic to `src/main.ts`.
- [ ] `src/guardrails-baseline.json` counts only went down (or are unchanged), and any lowered count is lowered in this PR.
- [ ] Any `// branch-ok: #<issue>` exemption links an issue where the user agreed to it.

## Testing

<!-- Checks run, tests added, browser smoke run. -->
