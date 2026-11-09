## What and why

<!-- What this changes and the issue it closes. -->

## Design and architecture check

<!-- Link the relevant issue and design sections. Explain any intentional change to doc/game.md or doc/game-architecture.md; if neither needs changing, say why. -->

## Composition check (required, see AGENTS.md "No special cases")

- [ ] Adds no branch on a phase, scene, room, mode, screen, material, kind, type, dealer, name or id (no `=== "literal"`, no `switch`).
- [ ] Reads no trait as a flag (`if (traits.x)`, `traits.x ? a : b`, `traits.x && …`); new behaviour lives in a trait, a registry keyed by trait or step name, or configuration on the definition.
- [ ] Treats identity as opaque: no mode or scene id used as a key or in `includes`/`has`, no mode named outside `src/game-modes.ts`, no side table keyed by a kind, phase, scene or material.
- [ ] Adds no game logic to `src/main.ts`.
- [ ] `src/guardrails-baseline.json` only lost lines (or is unchanged); no line was added, except a legacy line moved verbatim with its code.
- [ ] Any `// branch-ok: #<issue>` exemption links an issue where the user agreed to it.

## Testing

<!-- Checks run, tests added, browser smoke run. -->
