## What and why

<!-- What this changes and the issue it closes. -->

## Design and architecture check

<!-- Link the relevant issue and the design sections this PR satisfies. Documentation first: a rule or design change is its own documentation PR, merged before implementation. -->

- [ ] This is a documentation PR, **or** every behaviour it implements is already described in the merged doc/game.md / doc/game-architecture.md (cite the sections).
- [ ] This is one focused delivery; any recorded oversized-scope rejection is resolved under [the split process](../doc/process.md#oversized-tickets-reject-the-scope-and-return-it-for-a-split), or this PR is the process/design response rather than implementation of that rejected scope.
- [ ] Services stay narrow (no scene, mode, material or item identity; no outcome decisions or state diffing); policy lives in a configured controller trait (see "Services and controller traits").

## Composition check (required, see AGENTS.md "No special cases")

- [ ] Adds no branch on a phase, scene, room, mode, screen, material, kind, type, dealer, name or id (no `=== "literal"`, no `switch`).
- [ ] Reads no trait as a flag (`if (traits.x)`, `traits.x ? a : b`, `traits.x && …`); new behaviour lives in a trait, a registry keyed by trait or step name, or configuration on the definition.
- [ ] Treats identity as opaque: no mode or scene id used as a key or in `includes`/`has`, no mode named outside `src/game-modes.ts`, no side table keyed by a kind, phase, scene or material.
- [ ] Adds no game logic to `src/main.ts`.
- [ ] `src/guardrails-baseline.json` only lost lines (or is unchanged); no line was added, except a legacy line moved verbatim with its code.
- [ ] Any `// branch-ok: #<issue>` exemption links an issue where the user agreed to it.

## Testing

<!-- Checks run, tests added, browser smoke run. -->
