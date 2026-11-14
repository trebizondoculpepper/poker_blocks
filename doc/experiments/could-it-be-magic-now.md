# Could It Be Magic Now?

Agreed provisional passive experiment, #984. Exact title includes the question mark. The name is a song homage; no recording, lyrics or likeness is required. This is a bench experiment, not certified shop content.

## Model rule

Each installed instance starts with a play counter of zero. Every successful committed play increments once, regardless of the number of cards placed or rows scored. Rejected moves, discards, previews and restoration do not increment it. Progress carries across stages and rounds while the same instance remains installed and is saved/restored.

Every fourth play resets the counter and attempts exactly one conversion after the other post-scoring material reactions. The configured late model step runs after the existing post-score reaction/detonation sequence has drained, before final action/outcome settlement. It uses the resulting field, chooses one eligible non-Magic playable card uniformly with model-owned seeded RNG, and requests the registered material-change command. Preserve identity, rank, suit and ownership; ordinary documented material-change semantics govern material-owned state. Do not introduce a second scoring pass: the conversion benefits future plays. Magic retains its existing scoring and presentation behavior; this experiment adds no new Magic material reaction.

Already-Magic cards are excluded. If no eligible target exists, the conversion fails, the counter still resets, and no reward is banked. The player's play and score stand. Multiple instances resolve left to right in this late step; each selects against the resulting version after previous commands, so the second cannot select the first's now-Magic target. Generic code must not branch on this passive or material identity: configuration and registered selectors/commands provide behavior.

## Artwork and feedback to audition

Miniature magician's cabinet: midnight blue, gold trim, a hovering wand and glowing card. Four small stars across the front count plays. On a successful fourth-play trigger, a violet flash sends a sparkle toward the chosen card and the stars reset. With no eligible target, a soft fizzle accompanies the reset. This is an approved prototype direction, not accepted finished artwork. Check readability at rack scale and reduced-motion presentation. Timed cues use the shared scheduler and captured results; audio uses registered SFX IDs with stand-ins until assets exist. Inspectable text explains the rule and current progress.

## Experiment and delivery

Document the reusable [lifecycle and instance-state contract](../passive-lifecycle-state.md) before implementation. Test counters across stage boundaries, independent copies, multi-card plays, no-target failure, save/load without replay, deterministic selection, model/RNG rollback and post-reaction target selection. Audition the cabinet/countdown separately from balance acceptance. Use controlled bench scenarios and export configuration, initial state, seed and ordered moves; no player trials have been recorded yet. Price, shop weights and production certification are deliberately undecided.

## Measurements and next decision

For each controlled trial record committed play count, counter before/after, eligible target count, conversion successes/failures, selected target and material before/after, resulting scores on later plays, and the number of Magic cards created. Compare matched initial states and ordered actions with and without the passive; distinguish the conversion's later scoring benefit from unrelated material reactions. Observe whether the four-star countdown and target selection are understandable at rack scale, including the no-target fizzle.

The next decision is whether four-play pacing, persistent progress and random conversion produce a readable, worthwhile strategy in the bench, or need a revised provisional cadence/feedback. No measurements or price are asserted here. Production availability requires a later explicit certification decision and wider playtesting; a successful scripted trial alone does not certify it.
