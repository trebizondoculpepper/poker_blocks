# Gameplay events and effects

Status: initial contract for the scoring and passive implementation. This defines when traits can act; it does not yet wire the current demo to these events.

## Boundaries

- `GameState` contains the facts of play. The dealer validates actions and defines stage rules. The session controller advances stages, rounds, and shops.
- A gameplay coordinator emits named events at the points below. Installed passive blocks and other eligible blocks respond through their **trait definitions** and serializable trait settings. A block definition contains no callback code.
- A reaction receives the event's context and a read-only view of the current game state. It returns **effect descriptions**, not direct state mutations. The effect runner applies those descriptions and records any resulting events. Visual and sound requests are separate presentation effects.
- The base line finder, poker-hand evaluator, and `scoreLine` remain pure. The coordinator invokes them and applies any permitted effects around them.

## Event timeline for one play

An invalid play emits an action-denied presentation event only. It consumes nothing and does not score. For a valid play:

1. `play.beforePlace` runs after validation and before moving the block. It includes the hand block, proposed cell, and whether this is the first placement in the stage. A trait can react to that first-placement flag. Discards may have happened earlier.
2. The dealer moves the block from hand to field and consumes one play. `play.placed` reports the completed placement and the resulting state.
3. The coordinator discovers every maximal X/Y/Z line and evaluates its poker hand and contributing blocks. For each line, `score.beforeBlockValue` runs for each contributor while its `scorable` value can still be modified. Then the values are summed and the hand multiplier is applied. `score.beforeLineFinalized` runs while additive or multiplicative line effects can still change that line's points. Eligible passives resolve left to right in rack order at each event.
4. `score.lineFinalized` reports the immutable final points, hand type, and contributing blocks for that line. Reactions here may produce other gameplay effects, such as coins, but cannot retroactively change that line's score.
5. `score.allLinesFinalized` reports every immutable line result and their sum. `score.beforeTotalApplied` then offers a working stage-total delta that eligible traits may modify; it cannot rewrite any finalized line. The coordinator applies that delta, then emits `score.totalApplied` with the new running total.
6. The dealer evaluates the target and remaining plays. `stage.outcomeProposed` reports a pending win or loss before it is final; a trait intended to save a losing run or alter the outcome must act here. The dealer evaluates again after those effects. Then exactly one of `stage.won` or `stage.lost` reports the final result. Final outcome reactions cannot undo that result.
7. Presentation uses the finalized positive line results, ordered lowest to highest, to request `tint row` and score sounds. Presentation timing does not affect gameplay resolution.

`stage.started` fires after the dealer has prepared an empty field, allowances, and hand. It provides a separate hook for effects that should occur before any play or discard. Discarding has its own `discard.before` and `discard.completed` points and does not enter the scoring sequence.

## Context and ordering

Each event has a stable type, event ID, relevant stage and action IDs when applicable, and the specific IDs and values needed by its moment. For example, a line event includes its axis, ordered cell and block IDs, hand type, contributing block IDs, and current score components. Context is an immutable snapshot for the reaction. Traits must not mutate it or `GameState` directly.

Within an event, the dealer's fixed rule runs at its documented point, then eligible passives resolve from a snapshot of rack order, left to right. A passive can emit multiple effects; those effects are applied in the order it returns them before the next passive runs. The next passive sees the updated working value and resulting state, so `+10` then `×2` differs from `×2` then `+10`. A trait with an explicitly defined timing rule may use a different named phase; it does not silently jump ahead of the rack.

Gameplay effects are typed data commands, such as `add` or `multiply` a working score, add coins, consume a use, or destroy a block. An effect names its target and operation; a handler for that effect type applies it. The exact command catalog can grow with traits, but a command is valid only at a phase where its target is still mutable. Unknown or invalid commands fail clearly during development rather than being ignored. Presentation requests use a separate channel and cannot change scores or state.

Effects that cause further events enter a queue after the current event finishes; they do not recurse through the emitter. The runner must guard against infinite effect chains with a documented processing limit and an error that identifies the chain. The exact limit is an implementation choice.

## Open decisions before runtime wiring

- Which non-passive traits are eligible to react from the hand, field, deck, and other zones at each event.
- Which effect commands are needed for the first playable passive beyond score addition, score multiplication, coins, use consumption, and self-destruction.
- How effects that change placement legality or score inputs cause revalidation or recomputation. A pre-placement effect must not leave an invalid move committed.
