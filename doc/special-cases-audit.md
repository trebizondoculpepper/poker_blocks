# Special-case audit

An audit of every piece of special-case logic left in the game, and the plan that removes all
of it. Produced for [#68](https://github.com/trebizondoculpepper/poker_blocks/issues/68). **This
document changes no game code.** Its outputs are this map, the tickets it raises, and the
end-state test proposals.

Vocabulary follows [terms.md](terms.md): **game mode**, **game run**, **run setup**, **run
rules**, **scene**, **scene trait**, **trait**, **HUD panel**, **passive block**, **stage**,
**phase**, **shop**.

The rule under audit is [AGENTS.md](../AGENTS.md) "No special cases": behaviour comes only from
composed traits through registered handlers, because the point of the game is that unexpected
behaviour emerges from composing traits.

## Method

1. The line-pattern scan in [`src/guardrails.test.ts`](../src/guardrails.test.ts) was run over
   `main` at `87440b5`. It reports **75 legacy lines** in 16 files, recorded in
   [`src/guardrails-baseline.json`](../src/guardrails-baseline.json). Those 75 lines were
   enumerated individually, not counted.
2. **Every non-test module under `src/` was read** (77 files, listed in
   [Appendix A](#appendix-a-module-coverage)). Where a module is not named in a finding below, it
   is clean and the reason is given in that appendix.
3. A second, purpose-written scan looked for the shapes the committed guardrail **cannot** see:
   trait presence through `?.`, `Boolean(…)`, `!` and `?:`, identity used as a table key, and
   `includes`/`has` on an id. Every hit was then classified by hand, because the distinction that
   matters is not syntactic: **`traits.x?.field ?? default` is data access when the trait's
   _value_ is what matters, and a special case only when the trait's _presence_ decides
   behaviour.**
4. Each finding was mapped to an open ticket, or raised as a new one.

## Findings

Severity is not the issue's: all of these break the same rule. `SPREAD` means the finding is one
shape repeated across many lines.

### 1. `src/visual/block-appearance.ts` — 25 scan lines, the largest cluster

Every material is branched on or looked up by name in the renderer.

| Line                                                            | Shape                                               | What it is                           |
| --------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------ |
| 524 `printInk[kind]`                                            | identity as key                                     | side table indexed by material       |
| 586 `switch (kind)`                                             | kind switch                                         | per-material material setup          |
| 666, 670, 673, 701                                              | `kind === "prismatic"`                              | ior, envMap, fire, `const prismatic` |
| 889 `patternRelief[kind]`                                       | identity as key                                     | relief per material                  |
| 890, 902, 915                                                   | `kind === "ice"/"gold"/"paper"`                     | per-material textures                |
| 1005–1011                                                       | nested `kind === "meat"/"prismatic"/"gold"`         | ternary chain choosing appearance    |
| 1017                                                            | `["prismatic","fire","paper","ice"].includes(kind)` | identity set membership              |
| 1018, 1019                                                      | `edgeColors[kind]`, `edgeOpacities[kind]`           | side tables                          |
| 1021, 1039                                                      | `kind === "prismatic"/"fire"`                       | per-material extras                  |
| plus `"steel"`, `"wood"`, `"terracotta"`, `"gold"` at 1040–1055 | `kind === …`                                        | leftover chains                      |
| 1034 `endTexture = kind === "wood" ? … : null`                  | kind decision                                       | end grain for one material           |

**Why it is a special case:** the renderer is generic code that decides appearance by asking
which material a block is. Each new material edits the renderer.

**Owning design:** a **material definition** owns its appearance data, and the renderer reads it
uniformly. The material registry already exists as `blockMaterials` in
[`src/materials.ts`](../src/materials.ts); this needs it to carry the visual description that
`block-appearance.ts` currently rebuilds by branching.

**Ticket:** [#66](https://github.com/trebizondoculpepper/poker_blocks/issues/66) (already open,
already owned by another agent).

### 2. `src/run-controller.ts` — 10 scan lines, plus 2 the scan misses

| Line                                                           | Shape                       | What it is                                         |
| -------------------------------------------------------------- | --------------------------- | -------------------------------------------------- |
| `switchScene(sceneForPhase[game.phase])`                       | identity as key             | **sequencing in code**: phase → scene              |
| `.filter(… block.traits.selectable && …)`                      | trait as flag               | selection highlight asks a trait                   |
| `if (game.phase === "over")`                                   | phase branch                | game flow decided in the controller                |
| `const leavingShop = game.phase === "shop"`                    | phase branch                | ditto                                              |
| `if (!modeTraits.shop \|\| session.phase !== "shop" \|\| …)`   | trait + phase               | **both** a trait read as a flag and a phase branch |
| `const enterShop = game.phase === "shop" && fresh && …`        | phase branch                | presentation ordering by phase                     |
| `playSfx(game.phase === "shop" ? "shop.open" : "round.start")` | phase branch                | sound by phase                                     |
| `game.phase !== "over" && … stageRewardsPending`               | phase branch                | `canSellPassives`, an `isX`-style helper           |
| `offer.kind === "passive" ? … : …`                             | offer-kind branch           | price by offer kind                                |
| `if (bought.kind === "card")`                                  | offer-kind branch           | destination by offer kind                          |
| 230 `!modeTraits.passiveRack` (rack hidden)                    | trait read as flag (missed) | rack visibility from trait presence                |
| 355, 422 `cameraView.beginShopEntrance()`                      | phase-derived shop entrance | shop entrance by phase                             |

**Why they are special cases:** the run controller is the game's flow, and it currently decides
sequencing and presentation by asking what phase the run is in. Two of these also read a mode
trait only for its presence (`!modeTraits.passiveRack`), which is a marker with a new name.

**Owning design:** the **game flow is data** — a renamed scene must work without editing code —
and the phase machine belongs to a trait-composed flow rather than to `GameRun` plus a lookup
table. Rack visibility and shop stock are scene traits (the pattern #53 established); sound and
price follow the offer's own definition.

**Tickets:** [#36](https://github.com/trebizondoculpepper/poker_blocks/issues/36) (phase and
mode-trait branches), [#37](https://github.com/trebizondoculpepper/poker_blocks/issues/37)
(sequencing), [#67](https://github.com/trebizondoculpepper/poker_blocks/issues/67) (offer kinds),
[#65](https://github.com/trebizondoculpepper/poker_blocks/issues/65) (`traits.selectable`).

### 3. `src/passive-effects.ts` — 9 scan lines

| Line                         | Shape                                                           | What it is                            |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------- |
| 29 `switch (condition.kind)` | kind switch                                                     | passive condition evaluation          |
| 66, 67, 86, 87               | `rule.effect.kind === "multiply-value"/…`                       | passive effect application            |
| 110                          | `rule.on !== "stage.won" \|\| rule.effect.kind !== "add-coins"` | stage-reward accumulation singled out |
| 112                          | `rule.condition?.kind === "stage"`                              | condition kind as condition           |
| 135                          | `rule.effect.kind === "grant-unowned-passive"`                  | one effect singled out                |
| 139                          | `rule.effect.kind !== "add-coins"`                              | one effect singled out                |

**Why it is a special case:** passives are the game's headline composable feature, and scoring
currently decides what a passive does by asking which kind of rule it holds. Every new condition
or effect edits the scoring pipeline.

**Owning design:** passives bring their behaviour — a registry of condition handlers and effect
handlers keyed by the rule's own kind, where a test-only handler works without editing the
consumer.

**Ticket:** [#63](https://github.com/trebizondoculpepper/poker_blocks/issues/63).

### 4. `src/game-run.ts` — 7 scan lines, plus 3 the scan misses

| Line                                                       | Shape                        | What it is                                                       |
| ---------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------- |
| 99 `snapshot.phase === "shop" ? … : null`                  | phase branch                 | `shopAfter` reconstructed by phase                               |
| 308 offer price                                            | offer-kind branch            | price by kind                                                    |
| 310 `if (offer.kind === "passive")`                        | offer-kind branch            | purchase by kind                                                 |
| 353, 401 passive-id serial loops                           | id serial                    | rack id allocation                                               |
| 391 `if (event.type !== "discard.completed")`              | event-name branch            | one event singled out                                            |
| 499 `.filter(… offer.kind === "card")`                     | offer-kind branch            | leftover stock by kind                                           |
| 249 `block.traits.rackResident?.zone !== "passive-rack"`   | trait as condition (missed)  | rack admission decided by comparing a trait's field to a literal |
| 484 `if (this.shopAfter === "boss")`                       | identity comparison (missed) | round completion decided by which stage                          |
| 505 `if (completed === "boss" && …)`                       | stage-kind branch (missed)   | discard pile reset, again by stage                               |
| 538, 543 `this.config.handAtStageEnd === "return-to-deck"` | run-rule branch (missed)     | hand policy checked by value, twice                              |
| 198, 473, 475 `outcome === "playing"/"lost"`               | outcome branch               | scoring outcome                                                  |
| 284, 440 `this.currentPhase === "over"`                    | phase branch                 | run-over checks                                                  |

**Why they are special cases:** this is the **sequencing hard-coded in code** that the rule
calls out. `GameRun` is meant to be pure rules, but it knows what a shop is, which stage is the
boss, and what a discard event is called.

**Owning design:** `GameRun` is pure rules and the flow owns sequencing; offer kinds dispatch to
a registry; the rack's own id allocation is that zone's business.

**Tickets:** [#37](https://github.com/trebizondoculpepper/poker_blocks/issues/37),
[#67](https://github.com/trebizondoculpepper/poker_blocks/issues/67),
[#63](https://github.com/trebizondoculpepper/poker_blocks/issues/63).

### 5. `src/save.ts` — 7 scan lines, mostly exemptions

| Line                                                              | Shape             | Classification                                                                                                     |
| ----------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| 73 `offer.kind === "card"` (writing)                              | offer-kind branch | **special case** — see below                                                                                       |
| 102 `!phases.includes(record.phase) \|\| record.phase === "over"` | phase check       | **exemption: validating untrusted input**                                                                          |
| 104 `!dealers.has(record.dealer)`                                 | registry lookup   | **exemption: registry resolving a handle**                                                                         |
| 128 `if (offer.kind === "card")` (reading)                        | offer-kind branch | **mixed** — validation of an unknown shape (exempt) that also decides how to rebuild a passive (special case, #67) |
| 129 `offer.kind !== "passive" \|\| …`                             | shape validation  | **exemption**                                                                                                      |
| 163 `record.phase === "shop" && record.shopAfter`                 | phase branch      | **special case** — same `shopAfter` problem as `game-run.ts:99`, ticket #37                                        |
| 232 `if (snapshot.phase === "over") storage.removeItem(key)`      | phase branch      | **special case** — whether a run is finished is the flow's answer, ticket #37                                      |

**Why the mixed cases matter:** save parsing may validate a shape it does not recognise — that
is the one exemption the rule grants. It may not decide game behaviour by asking which phase or
offer kind it is reading. `toSaveRecord`'s offer branch (68) is pure serialisation of a known
union, so it is closer to exempt, but it duplicates the offer-kind knowledge that #67 will
centralise; it should move behind the offer's own save shape.

**Tickets:** [#37](https://github.com/trebizondoculpepper/poker_blocks/issues/37),
[#67](https://github.com/trebizondoculpepper/poker_blocks/issues/67).

### 6. `src/traits/selectable.ts` — 3 scan lines, plus 4 the scan misses

| Line                                                                    | Shape                  | What it is                    |
| ----------------------------------------------------------------------- | ---------------------- | ----------------------------- |
| 7, 15, 20                                                               | trait as flag          | add/remove/toggle by presence |
| `transparent.ts:11` `Boolean(block.traits.transparent)`                 | trait coerced (missed) | marker read as a flag         |
| `destructible.ts:17` `traits.destructible?.by.includes(cause) ?? false` | trait ternary (missed) | destruction permission        |
| `table-input.ts:481` hover cursor                                       | trait ternary          | cursor by presence            |
| `rendered-blocks.ts:121` `Boolean(block.traits.selectable) && …`        | trait coerced (missed) | highlight by presence         |

**Why they are special cases:** `selectable`, `transparent` and `destructible` are empty or
near-empty markers whose behaviour lives in helpers outside them. `isTransparent`, `canDestroy`
and `withoutSelectable` are exactly the "`isX`/`canX` helper that only tests presence" the rule
names.

**Owning design:** block traits bring their own behaviour — each carries its own `handles`,
eligibility or presentation hook rather than being inspected.

**Ticket:** [#65](https://github.com/trebizondoculpepper/poker_blocks/issues/65).

### 7. Audio — 3 scan lines across two files

| Line                                          | Shape           | What it is            |
| --------------------------------------------- | --------------- | --------------------- |
| `audio-service.ts` `stageMusic[phase](music)` | identity as key | track chosen by phase |
| `audio-service.ts` `screenMusic[screen]()`    | identity as key | cue chosen by screen  |
| `audio/music-plan.ts:45` `switch (scene)`     | scene switch    | track pool by scene   |

`screenMusic` is keyed by a **configuration option**-like value (the screen a menu put in
front), which the rule exempts as a handler table; it is listed here for completeness and because
the screen is also a scene identity. `stageMusic[phase]` is **not** exempt: the phase is a stage
kind, and a stage kind should own its music. `pickTrack`'s switch over `MusicScene` is the same
question one layer down.

**Owning design:** #35 makes every screen a scene whose traits install its behaviour, including
music; a stage's music then comes from the scene in front rather than a phase-keyed table.

**Tickets:** [#35](https://github.com/trebizondoculpepper/poker_blocks/issues/35). **New:**
[#70](https://github.com/trebizondoculpepper/poker_blocks/issues/70) for `music-fade.ts`.

### 8. `src/hud-panels.ts` — 2 scan lines

| Line                                       | Shape           | What it is         |
| ------------------------------------------ | --------------- | ------------------ |
| 90 `nextActionLabels[view.phase](outcome)` | identity as key | HUD label by phase |
| 100 `phaseNames[view.phase]`               | identity as key | heading by phase   |

**Why it is a special case:** the HUD service is generic presentation, and it decides its
heading and its button by looking up the run's phase. #53 already moved _which panels show_ to
scene traits; this is the remaining phase knowledge, which #36 removes by making the scene supply
its own label data.

**Ticket:** [#36](https://github.com/trebizondoculpepper/poker_blocks/issues/36).

### 9. `src/materials.ts` — 2 scan lines, plus 1 the scan misses

| Line                                        | Shape                  | What it is                                         |
| ------------------------------------------- | ---------------------- | -------------------------------------------------- |
| 66 `transparentMaterials.has(kind)`         | identity set           | transparency by material name                      |
| 67 `materialNames[kind]`                    | identity as key        | display name by material                           |
| 38 `block.traits.material?.kind ?? "paper"` | trait ternary (missed) | material read, with `"paper"` as a literal default |

**Why they are special cases:** `materialNames[kind]` and a `"paper"` fallback name a specific
material in generic code. The `has` test also duplicates the block's own `transparent` trait,
which is what #65 makes authoritative.

**Owning design:** the material definition carries its name and its traits; `materialOf` returns
a definition, not a name to be looked up again.

**Tickets:** [#66](https://github.com/trebizondoculpepper/poker_blocks/issues/66),
[#65](https://github.com/trebizondoculpepper/poker_blocks/issues/65).

### 10. `src/shop-view.ts` — 2 scan lines, plus 1 the scan misses

| Line                                                    | Shape                  | What it is                            |
| ------------------------------------------------------- | ---------------------- | ------------------------------------- |
| 120 `if (offer.kind === "passive")`                     | offer-kind branch      | display by kind                       |
| 194 `const passive = offer.kind === "passive"`          | offer-kind branch      | drag label by kind                    |
| 197 `offer.block.traits.inspectable?.inspect() ?? name` | trait ternary (missed) | **exemption** — reads a trait's value |

**Tickets:** [#67](https://github.com/trebizondoculpepper/poker_blocks/issues/67).

### 11. `src/game-modes.ts` — 1 scan line

`...sceneTraits[kind]` builds the scene catalogue by indexing a table with the scene kind. This
is legitimately _configuration being assembled_, but it is also why a renamed scene needs a code
edit. **Ownership is genuinely ambiguous** between #35 (screens as scenes) and #37 (flow as
data), which is why the issue asks for a decision.

**Recommendation:** #35. It will replace the per-mode catalogue with scene definitions that
declare their own traits, at which point the `[kind]` index disappears. Because the ownership is
genuinely ambiguous and the issue asks for a decision, it is recorded in its own ticket:
[#72](https://github.com/trebizondoculpepper/poker_blocks/issues/72). **Owner: #35.**

### 12. `src/run-rules.ts` — 1 scan line

`baseTargets[kind]` chooses a stage's target score by stage kind. Run rules are meant to be the
data a mode supplies, and a stage kind's numbers are exactly that data.

**Ticket:** [#37](https://github.com/trebizondoculpepper/poker_blocks/issues/37).

### 13. `src/audio/music-fade.ts` — 1 scan line, **no owner**

`switch (kind)` over a fade curve. **Why it is a special case:** a fade kind is a kind like any
other, and the curve is its behaviour. Each new curve edits the mixer.

**Owning design:** a fade registry keyed by the curve's name — `fadeCurves.get(kind)` is a
registry resolving a handle, but the _curve_ should be registered against its own definition, so
the mixer never switches. **New ticket:**
[#70](https://github.com/trebizondoculpepper/poker_blocks/issues/70).

### 14. `src/table-input.ts` — 1 scan line, plus 1 the scan misses

`hovered?.block.traits.selectable ? "pointer" : "default"` and (missed)
`if (fieldActive && source?.block.traits.attachable)`.

**Ticket:** [#65](https://github.com/trebizondoculpepper/poker_blocks/issues/65).

### 15. `src/listening-room/main.ts` — 1 scan line, **decision needed**

`entries.find((_, index) => soundEffects[index].id === "score.line")`. This is a **developer
tool**, not the game: it is a separate page (`listening-room/`, alongside `music-room/`) whose job
is to audition sounds by id.

**Recommendation: exempt, with the reason recorded.** It is not game code, has no run, no mode
and no traits, and its whole purpose is to name specific sound ids. Exempting it is recorded here
rather than silently ignored. If the project would rather not exempt it, it belongs in a ticket
that treats auditioning tools as out of scope for the composition rule — I have raised
[#71](https://github.com/trebizondoculpepper/poker_blocks/issues/71) so the decision is visible
rather than buried in this document.

### 16. `src/menus.ts` — 1 finding the scan misses

`if (settingsFrom === "title") showTitle(); else closeAll();` — the settings menu remembers which
screen it was opened from and decides what Back does. That is a screen-identity branch in generic
menu code, and it is invisible to the scan because the value is a variable.

**Why it is a special case:** the menu asks where it came from instead of the scene stack
answering what Back means. Popping the stack already does the right thing.

**Ticket:** [#35](https://github.com/trebizondoculpepper/poker_blocks/issues/35).

### 17. `src/material-sampler.ts` — 1 finding the scan misses

`deck.find((card) => … materialOf(card) === material)` — the sampler walks a hard-coded
`blockMaterials` list and asks each card what material it is.

**Why it is a special case:** sampling materials is a development build step that knows the
material list. It is a **run setup step** (like `materialSample`), so it may legitimately name
its own configuration — but comparing a card's material to a loop variable is still identity
work in generic code. It should ask the deck for one block per material _definition_.

**Ticket:** [#66](https://github.com/trebizondoculpepper/poker_blocks/issues/66) (material
definitions), with a note that the sampler is a run setup step and so may know its own config.

### 18. `src/settings.ts` — 1 finding the scan misses

`setting === "system" ? systemReduced : setting === "reduced"` and `resolveShadowQuality`'s
equivalent. The value is the player's **setting**, read from a dropdown, not a game kind. This is
**configuration being interpreted**, which the rule exempts — but it is listed so the exemption is
recorded.

**Exemption:** interpreting player settings, not deciding game behaviour.

### 19. `src/table-input.ts` pointer types — 3 findings the scan misses

`event.pointerType === "touch"` at 374, 483, 495, 514, 521. **Exemption:** this is browser
input, not a game kind. The platform tells us the pointer type; there is no trait to compose.

### 20. `src/audio/music-player.ts` `context.state === "suspended"`

**Exemption:** a platform API's own state, not a game kind.

### 21. `src/core/block.ts`, `src/passive-rack.ts`, `src/passives.ts` — data access, not flags

- `block.ts:26` `if (this.traits.has(def))` — a registry resolving a handle. **Exemption.**
- `passive-rack.ts:151` `block.traits.appearance ?? definition` — reads a trait's **value** to
  choose an appearance. **Exemption:** data access, not a presence decision.
- `passives.ts:12` `rule.on === on` — filtering rules by the event they subscribe to. This is
  the passives rule list doing its own dispatch, and it is closer to a #63 finding than an
  exemption; noted there.
- `shop-view.ts:122, 197`, `traits/inspectable.ts:12`, `traits/scorable.ts:14` — read a trait's
  value with a default. **Exemptions.**

## Exemptions, with reasons

| Location                                                                             | Reason                                                                   |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `save.ts` phase/shape validation (102, 119), `dealers.has` (106)                     | Validating untrusted input; a registry resolving a handle                |
| `settings.ts` motion and shadow settings                                             | Interpreting the player's setting, not a game kind                       |
| `table-input.ts` `pointerType === "touch"` (×5)                                      | Browser input, not a game kind                                           |
| `audio/music-player.ts` `context.state === "suspended"`                              | Platform API state                                                       |
| `audio-service.ts` `screenMusic[screen]()`                                           | Handler table keyed by the screen a menu put in front                    |
| `core/block.ts:26` `traits.has(def)`                                                 | Registry resolving a handle                                              |
| `passive-rack.ts:151`, `shop-view.ts:122,197`, `inspectable.ts:12`, `scorable.ts:14` | Reading a trait's value with a default, not asking whether it is present |
| `listening-room/main.ts:148`                                                         | Developer audition tool, not the game — pending the decision in #71      |
| All test files                                                                       | Tests may name anything                                                  |

## End state: the positive tests that prove full trait composition

The line-pattern baseline can only ever say "no _new_ offenders of the shapes we thought of".
These tests would say the game _is_ composed. Each is mapped to the ticket that adds it.

| #   | Test                                                                                                                                                                                                                     | What it proves                                  | Ticket                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **A renamed copy of every mode behaves identically.** Register `dev3_copy` with a different save key and console name; assert the same scenes, run setup and behaviour.                                                  | No generic code knows a specific mode.          | [#35](https://github.com/trebizondoculpepper/poker_blocks/issues/35), [#36](https://github.com/trebizondoculpepper/poker_blocks/issues/36)                                                                                                                                                                                                                   |
| 2   | **An id only ever flows into a handle use** — registry lookup, scene id, save key, URL, display — asserted by a type-level test over the id-bearing registries.                                                          | Identity is never a switch.                     | [#36](https://github.com/trebizondoculpepper/poker_blocks/issues/36), [#37](https://github.com/trebizondoculpepper/poker_blocks/issues/37)                                                                                                                                                                                                                   |
| 3   | **A test-only handler registered without editing any consumer, per registry:** scene traits, run setup steps, passive conditions, passive effects, passive selectors, block traits, materials, offer kinds, fade curves. | Every registry is genuinely open for extension. | [#63](https://github.com/trebizondoculpepper/poker_blocks/issues/63), [#65](https://github.com/trebizondoculpepper/poker_blocks/issues/65), [#66](https://github.com/trebizondoculpepper/poker_blocks/issues/66), [#67](https://github.com/trebizondoculpepper/poker_blocks/issues/67), [#70](https://github.com/trebizondoculpepper/poker_blocks/issues/70) |
| 4   | **The game flow is data:** a renamed scene works without editing code — register a scene under a new name and reach it through the flow alone.                                                                           | Sequencing is not hard-coded.                   | [#37](https://github.com/trebizondoculpepper/poker_blocks/issues/37)                                                                                                                                                                                                                                                                                         |
| 5   | **A new material needs no renderer edit:** add a material definition and render it, with no change to `block-appearance.ts`.                                                                                             | Appearance is data.                             | [#66](https://github.com/trebizondoculpepper/poker_blocks/issues/66)                                                                                                                                                                                                                                                                                         |
| 6   | **A new offer kind needs no edit to pricing, buying, saving or display.**                                                                                                                                                | Offer kinds dispatch.                           | [#67](https://github.com/trebizondoculpepper/poker_blocks/issues/67)                                                                                                                                                                                                                                                                                         |
| 7   | **A new passive rule needs no edit to scoring:** register a condition and an effect in the test and score with them.                                                                                                     | Passives own their behaviour.                   | [#63](https://github.com/trebizondoculpepper/poker_blocks/issues/63)                                                                                                                                                                                                                                                                                         |
| 8   | **A block trait brings its behaviour:** remove the `isTransparent`/`canDestroy`-style helpers and assert the trait supplies the answer.                                                                                  | No marker with behaviour elsewhere.             | [#65](https://github.com/trebizondoculpepper/poker_blocks/issues/65)                                                                                                                                                                                                                                                                                         |

**Retiring the baseline.** The line-pattern baseline should be retired once tests 1–8 pass for
every registry, in this order:

1. When #35, #36 and #37 are done, tests 1, 2 and 4 make `run-controller.ts`, `hud-panels.ts`,
   `game-modes.ts`, `save.ts` and `run-rules.ts` provably free of identity logic — delete their
   baseline entries then, not before.
2. When #63, #65, #66 and #67 are done, tests 3, 5, 6, 7 and 8 cover the remaining files.
3. At that point `guardrails-baseline.json` should be empty, and the scan should stay as a cheap
   regression net for shapes nobody has thought to write a positive test for.

## Proposed order

Architecture before game design, and the highest fan-out first. Rows in the same group can run in
parallel; each group depends on the one above it.

| Group                                | Tickets       | Why here                                                                                                                                                                                                                  |
| ------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — flow and identity**            | #37, then #36 | Every other ticket needs the flow to be data and the phase branches gone; #36 depends on #37's `shopAfter` and phase ownership. Nothing else can start cleanly until the run controller stops asking what phase it is in. |
| **B — extension points** (parallel)  | #63, #65, #67 | Independent of each other and of the flow once A lands: passives, block traits and offer kinds each need a registry and nothing from the other two.                                                                       |
| **C — presentation data** (parallel) | #66, #70      | #66 (materials as data) is independent of A and B and is already in progress. #70 (fade curves) is tiny and fully independent.                                                                                            |
| **D — screens**                      | #35           | Last: it rewrites the menu and music layers onto scenes, and benefits from A's flow-as-data. It closes `menus.ts`, the audio entries and `game-modes.ts:66` together.                                                     |
| **E — decisions**                    | #71, #72      | Records the `listening-room` exemption and the `sceneTraits[kind]` owner so neither stays an open question. Can be done at any time; #72 should be settled before #35 or #37 starts.                                      |

**Dependencies, explicitly:**

- #36 → #37 (needs flow-as-data and `shopAfter` off the phase).
- #35 → #36 (menus need the scene stack to be the flow).
- #67 → #36 for the run controller's two offer branches, and #37 for `game-run.ts`'s.
- Nothing blocks #63, #65, #66 or #70.

**Parallelism:** groups B and C are five tickets that can run at once across five agents without
touching the same files, which is the fastest route to an empty baseline. A is a single lane and
is the critical path.

## Appendix A: module coverage

Every non-test module under `src/` (77 files) was read. Findings name the file; the rest are
listed with the reason they are clean.

**Has findings:** `block-appearance.ts` (1), `run-controller.ts` (2), `passive-effects.ts` (3),
`game-run.ts` (4), `save.ts` (5), `selectable.ts` (6), `audio-service.ts` (7),
`music-plan.ts` (7), `hud-panels.ts` (8), `materials.ts` (9), `shop-view.ts` (10),
`game-modes.ts` (11), `run-rules.ts` (12), `music-fade.ts` (13), `table-input.ts` (14),
`menus.ts` (16), `material-sampler.ts` (17), `transparent.ts`/`destructible.ts`/
`rendered-blocks.ts` (6).

**Clean, with reason:**

| Modules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Why clean                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/registry.ts`, `core/trait.ts`, `core/block.ts`, `core/emitter.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Generic infrastructure; registries resolve handles. `block.ts:26` is a handle lookup.                                                                                                                   |
| `scenes.ts`, `scene-behaviours.ts`, `run-setup.ts`, `run-setup-behaviours.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                               | The composition machinery itself; handlers are keyed by trait and step names.                                                                                                                           |
| `dealer.ts`, `deal.ts`, `cards.ts`, `scoring.ts`, `round.ts`, `zones.ts`, `run-stats.ts`, `stage-rewards.ts`, `shop-stock.ts`, `score-presentation.ts`                                                                                                                                                                                                                                                                                                                                                                                      | No identity branching; `dealer.ts`'s `roundOutcome(state) === "playing"` is reading a computed rule outcome, and its `typeof cardIds === "string"` is argument normalisation.                           |
| `passives.ts`, `passive-rack.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Rule filtering by subscribed event and a trait-value default; the `rule.on` dispatch is noted in #63.                                                                                                   |
| `overlays.ts`, `console-host.ts`, `console/*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Screens and commands are keyed by their own names through handler tables (`screenScenes`), which the rule exempts.                                                                                      |
| `main.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Wiring only; `run.mode.traits.passiveRack?.capacity` reads a trait's value for a service's construction.                                                                                                |
| `settings.ts`, `motion.ts`, `easing.ts`, `view-zoom.ts`, `screenshot.ts`, `table-renderer.ts`, `camera-view.ts`, `center-of-gravity.ts`, `hand-view.ts`, `field-view.ts`, `play-presenter.ts`, `visual/materialise.ts`, `visual/card-room.ts`, `visual/crystal-fire.ts`, `visual/fire-core.ts`, `audio/beat-clock.ts`, `audio/music-catalog.ts`, `audio/music-controller.ts`, `audio/music-player.ts`, `audio/music-wind.ts`, `audio/sfx.ts`, `audio/sfx-registry.ts`, `console/command-line.ts`, `console/console-view.ts`, `music-room/*` | Presentation, platform or infrastructure with no game-kind branching; where a name is compared it is a settings value, a pointer type, a platform state or a keyboard code (exemptions recorded above). |
| `listening-room/main.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Has a finding; developer tool — decision in #71.                                                                                                                                                        |
| `traits/attachable.ts`, `traits/inspectable.ts`, `traits/scorable.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Trait definitions and value readers; `inspectable`/`scorable` read a value with a default.                                                                                                              |
| `scene-traits/dev-manual-block-destroyer.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | A dev scene trait that brings its own behaviour.                                                                                                                                                        |

## Appendix B: every baselined line, with its owner

All 75 lines recorded in `src/guardrails-baseline.json`, mapped to exactly one
ticket. Generated by locating each recorded line in its file, so the `line` column is the
line as it stands at `87440b5`.

| File                             | line            | Recorded line                                                                                    | Ticket         |
| -------------------------------- | --------------- | ------------------------------------------------------------------------------------------------ | -------------- |
| `src/audio-service.ts`           | 121             | `screenMusic[screen]();`                                                                         | #35            |
| `src/audio-service.ts`           | 115             | `stageMusic[phase](music);`                                                                      | #35            |
| `src/audio/music-fade.ts`        | 21              | `switch (kind) {`                                                                                | #70            |
| `src/audio/music-plan.ts`        | 45              | `switch (scene) {`                                                                               | #35            |
| `src/game-modes.ts`              | 66              | `...sceneTraits[kind],`                                                                          | #35            |
| `src/game-run.ts`                | 99              | `session.shopAfter = snapshot.phase === "shop" ? (snapshot.shopAfter ?? "boss") : null;`         | #37            |
| `src/game-run.ts`                | 308             | `offer.kind === "passive" ? this.passivePrices.buy : (this.config.cardPurchasePrice ?? 1);`      | #67            |
| `src/game-run.ts`                | 310             | `if (offer.kind === "passive") {`                                                                | #67            |
| `src/game-run.ts`                | 353             | `while (this.currentState.passiveRack.some(({ id }) => id === `passive.${serial}`)) serial++;`   | #37            |
| `src/game-run.ts`                | 391             | `if (event.type !== "discard.completed") return [];`                                             | #37            |
| `src/game-run.ts`                | 353, 401        | `while (this.currentState.passiveRack.some(({ id }) => id === `passive.${serial}`))`             | #37            |
| `src/game-run.ts`                | 499             | `.filter((offer): offer is Extract<ShopOffer, { kind: "card" }> => offer.kind === "card")`       | #67            |
| `src/hud-panels.ts`              | 90              | `const action = view.presenting ? null : nextActionLabels[view.phase](outcome);`                 | #36            |
| `src/hud-panels.ts`              | 100             | `heading: `ROUND ${view.round} · ${phaseNames[view.phase]}${outcomeSuffixes[outcome]}`,`         | #36            |
| `src/listening-room/main.ts`     | 130             | `const entry = entries.find((_, index) => soundEffects[index].id === "score.line");`             | #71 (decision) |
| `src/materials.ts`               | 66              | `...(transparentMaterials.has(kind) ? { transparent: {} } : {}),`                                | #66            |
| `src/materials.ts`               | 67              | `inspectable: inspectable(`${cardName(card.traits.identity)} · ${materialNames[kind]}`),`        | #66            |
| `src/passive-effects.ts`         | 29              | `switch (condition.kind) {`                                                                      | #63            |
| `src/passive-effects.ts`         | 66              | `if (rule.effect.kind === "multiply-value") value *= rule.effect.factor;`                        | #63            |
| `src/passive-effects.ts`         | 67              | `if (rule.effect.kind === "add-value") value += rule.effect.amount;`                             | #63            |
| `src/passive-effects.ts`         | 86              | `if (rule.effect.kind === "multiply-line") points *= rule.effect.factor;`                        | #63            |
| `src/passive-effects.ts`         | 87              | `if (rule.effect.kind === "add-line")`                                                           | #63            |
| `src/passive-effects.ts`         | 110             | `if (rule.on !== "stage.won" \|\| rule.effect.kind !== "add-coins") continue;`                   | #63            |
| `src/passive-effects.ts`         | 112             | `if (rule.condition?.kind === "stage") {`                                                        | #63            |
| `src/passive-effects.ts`         | 135             | `if (rule.effect.kind === "grant-unowned-passive") {`                                            | #63            |
| `src/passive-effects.ts`         | 139             | `if (rule.effect.kind !== "add-coins") continue;`                                                | #63            |
| `src/run-controller.ts`          | 211             | `switchScene(sceneForPhase[game.phase]);`                                                        | #36            |
| `src/run-controller.ts`          | 268             | `.filter(({ block }) => block.traits.selectable && selected.has(block.id))`                      | #65            |
| `src/run-controller.ts`          | 312             | `if (game.phase === "over") {`                                                                   | #36            |
| `src/run-controller.ts`          | 328             | `const leavingShop = game.phase === "shop";`                                                     | #36            |
| `src/run-controller.ts`          | 392             | `if (!modeTraits.shop \|\| session.phase !== "shop" \|\| session.state.shopStock !== undefined)` | #36            |
| `src/run-controller.ts`          | 421             | `const enterShop = game.phase === "shop" && fresh && !reducedMotion;`                            | #36            |
| `src/run-controller.ts`          | 426             | `playSfx(game.phase === "shop" ? "shop.open" : "round.start");`                                  | #36            |
| `src/run-controller.ts`          | 479             | `game.phase !== "over" && !services.presenter.busy && !game.stageRewardsPending,`                | #36            |
| `src/run-controller.ts`          | 621             | `offer.kind === "passive" ? game.passivePrices.buy : (runRules.cardPurchasePrice ?? 1),`         | #67            |
| `src/run-controller.ts`          | 629             | `if (bought.kind === "card") {`                                                                  | #67            |
| `src/run-rules.ts`               | 48              | `targetScore: Math.round(baseTargets[kind] * (1 + (round - 1) / 2)),`                            | #37            |
| `src/save.ts`                    | 73, 128         | `offer.kind === "card"`                                                                          | #67            |
| `src/save.ts`                    | 102             | `if (!phases.includes(record.phase) \|\| record.phase === "over") return null;`                  | #37            |
| `src/save.ts`                    | 104             | `if (!dealers.has(record.dealer)) return null;`                                                  | #37            |
| `src/save.ts`                    | 128             | `if (offer.kind === "card") return { kind: "card" as const, block: resolve(offer.cardId) };`     | #67            |
| `src/save.ts`                    | 129             | `if (offer.kind !== "passive" \|\| typeof offer.id !== "string" \|\| passiveIds.has(offer.id))`  | #37            |
| `src/save.ts`                    | 163             | `...(record.phase === "shop" && record.shopAfter ? { shopAfter: record.shopAfter } : {}),`       | #37            |
| `src/save.ts`                    | 232             | `if (snapshot.phase === "over") storage.removeItem(key);`                                        | #37            |
| `src/shop-view.ts`               | 120             | `if (offer.kind === "passive") {`                                                                | #67            |
| `src/shop-view.ts`               | 194             | `const passive = offer.kind === "passive";`                                                      | #67            |
| `src/table-input.ts`             | 481             | `canvas.style.cursor = hovered?.block.traits.selectable ? "pointer" : "default";`                | #65            |
| `src/traits/selectable.ts`       | 7               | `if (!block.traits.selectable) return block;`                                                    | #65            |
| `src/traits/selectable.ts`       | 15              | `if (block.traits.selectable) return block;`                                                     | #65            |
| `src/traits/selectable.ts`       | 20              | `if (!block.traits.selectable) return current;`                                                  | #65            |
| `src/visual/block-appearance.ts` | 524             | `const ink = printInk[kind];`                                                                    | #66            |
| `src/visual/block-appearance.ts` | 586             | `switch (kind) {`                                                                                | #66            |
| `src/visual/block-appearance.ts` | 666             | `ior: kind === "prismatic" ? 2.33 : 1.5,`                                                        | #66            |
| `src/visual/block-appearance.ts` | 670             | `envMapIntensity: kind === "prismatic" ? 1.6 : 1.1,`                                             | #66            |
| `src/visual/block-appearance.ts` | 673             | `...(kind === "prismatic" ? prismaticFire : {}),`                                                | #66            |
| `src/visual/block-appearance.ts` | 701             | `const prismatic = kind === "prismatic";`                                                        | #66            |
| `src/visual/block-appearance.ts` | 889             | `const relief = { bumpMap: height ?? texture, bumpScale: patternRelief[kind] };`                 | #66            |
| `src/visual/block-appearance.ts` | 890, 1066       | `if (kind === "ice") {`                                                                          | #66            |
| `src/visual/block-appearance.ts` | 902             | `if (kind === "gold") {`                                                                         | #66            |
| `src/visual/block-appearance.ts` | 915             | `if (kind === "paper") {`                                                                        | #66            |
| `src/visual/block-appearance.ts` | 1005            | `kind === "meat"`                                                                                | #66            |
| `src/visual/block-appearance.ts` | 666, 670, 1007  | `: kind === "prismatic"`                                                                         | #66            |
| `src/visual/block-appearance.ts` | 1011            | `: kind === "gold"`                                                                              | #66            |
| `src/visual/block-appearance.ts` | 1017            | `if (["prismatic", "fire", "paper", "ice"].includes(kind)) geometry.scale(0.985, 0.985, 0.985);` | #66            |
| `src/visual/block-appearance.ts` | 1018            | `const edgeColor = edgeColors[kind];`                                                            | #66            |
| `src/visual/block-appearance.ts` | 1019            | `const edgeOpacity = edgeOpacities[kind];`                                                       | #66            |
| `src/visual/block-appearance.ts` | 1021            | `if (kind === "prismatic") {`                                                                    | #66            |
| `src/visual/block-appearance.ts` | 1039            | `if (kind === "fire") {`                                                                         | #66            |
| `src/visual/block-appearance.ts` | 1085            | `if (kind === "steel") {`                                                                        | #66            |
| `src/visual/block-appearance.ts` | 902, 1011, 1101 | `kind === "gold"`                                                                                | #66            |
| `src/visual/block-appearance.ts` | 1103            | `: kind === "paper"`                                                                             | #66            |
| `src/visual/block-appearance.ts` | 1105            | `: kind === "wood"`                                                                              | #66            |
| `src/visual/block-appearance.ts` | 1107            | `: kind === "terracotta"`                                                                        | #66            |
| `src/visual/block-appearance.ts` | 1114            | `const endTexture = kind === "wood" ? faceTexture(identity, kind, true) : null;`                 | #66            |

**Ownership totals:**

- #35: 4 lines
- #36: 9 lines
- #37: 10 lines
- #63: 9 lines
- #65: 5 lines
- #66: 27 lines
- #67: 9 lines
- #70: 1 lines
- #71 (decision): 1 lines
