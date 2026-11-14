# Passive lifecycle actions and instance state

Owner decisions, 2026-11-13; experiment #984. This is the target contract, not a claim that every runtime path implements it.

## Actions, phases and ordering

A passive may register multiple actions at different lifecycle points. Scoring definitions explicitly state whether an action runs once before any rows score, once for each committed scored row, or once after all rows score. Per-row actions also declare the existing arithmetic hook they use. Within the same hook, resolve rack instances in captured left-to-right order. Rack position never moves a handler across lifecycle phases or changes the documented material/addition/multiplication/power arithmetic order. A once-per-play addition and a per-row addition are distinct balance choices, not interchangeable implementations.

Dice demonstrates two responsibilities: roll once before the scoring operation's rows resolve, then reuse that result for each scored row at its configured additive hook. This clarification does not move its existing addition from after the line's zero clamp or introduce repeated exponentiation for In the Loop. Store each roll under the scoring operation and passive instance; another play or another die cannot overwrite it. Trial/candidate scoring does not consume the committed RNG stream, roll, counter or uses. Presentation receives resolved outcomes and never rerolls.

## Persistent state belongs to the instance

Definitions provide behavior and defaults; each installed passive object owns its own versioned serializable state. Counters and remembered progress must not live on a shared definition, module variable, presenter or registry entry. Two experimental copies have independent state, even when their definitions match. The current shop's duplicate restrictions remain unchanged.

Each stateful definition declares initialization, lifetime and reset policy. Persistent instance state survives stage changes and save/load where specified; operation-scoped scratch state, such as a roll reused during one scoring action, belongs to that action. Restoration hydrates state and rebuilds subscriptions without replaying gameplay or consuming RNG. Removal disposes subscriptions; transfer/reset/clone behavior must follow the separately documented capabilities, not silently create a new identity or fresh counter.

Registered model handlers request commands; generic runners never identify a particular passive. Stage instance-state writes and RNG with the action transaction so failure rolls both back. A defined no-target outcome is successful resolution of a failed effect, not a transaction error. Phase and listener order follows [game-events.md](game-events.md); visuals consume immutable records on the shared scheduler and do not block input.

## Evidence and limits

The source audit finds Dice configured through `die` and registered `roll` value sources in `src/passives.ts`, with behavior tests in `src/dice.test.ts`. The lifecycle contract already defines committed placement batches, left-to-right subscriptions, transaction rollback and restoration in [game-events.md](game-events.md). Those support extending the registered model rather than adding identity branches. Instance-state storage, migration and persistence completeness still require implementation audit; the audit is not evidence that a general counter API already exists.

Alternatives rejected: a single action point per passive cannot express roll-then-reuse; counters on shared definitions couple independent copies; presentation-owned state breaks model-first saving and overlapping plays. The new [Magic experiment](experiments/could-it-be-magic-now.md) exercises persistent progress. Balance, normal-shop availability and certification remain experimental.
