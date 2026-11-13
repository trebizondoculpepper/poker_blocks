# Phased material consequences

Owner decision, 2026-11-13 (#865, implementation #614). This supersedes the older blanket one-step-per-play/no-cascades rule. A play can produce immediate changes, score the changed layout, then cause later changes in that same play. The intention is a readable chain of consequences, not physically simulated time or model delays.

## Authored phases and shared ownership

A reaction definition declares a registered timing/phase contribution. The playfield-composed material controller dispatches those contributions at the generic lifecycle barriers; the gameplay coordinator does not ask what material or reaction is present. Existing placement timing remains pre-score and omitted timing remains afterScore for compatibility. Future timings require an explicitly documented registered step, not a literal branch in generic code.

Opening/replacement resolves first. Then pre-score placement reactions resolve, followed by countdown deductions. Score the resulting field once through normal scored-subset rules. Post-score reactions resolve next, then pending detonations in countdown-discovery order. Drain registered follow-up commands/facts at each step barrier before the next step; use the same action-wide transaction and budget. Outcome proposal/finalization comes after all model phases. A stage result scene waits for required presentation scopes, not for another model calculation.

Assign phases by intended perceived speed: immediate/quick responses before scoring, slower-feeling processes afterward. This is an authored design choice that makes the move understandable and consequential. Do not infer phase from real mass, temperature, a shader, material identity or a wall-clock duration.

## Deterministic bounded cross-phase chaining

Use one reaction-selection snapshot for each configured reaction step, taken from the working field when that step begins. Opening and prior-step changes are already included. For each block in stable field/placement order, select at most the first matching reaction for THIS step from the definition's listed applicable reactions, reading neighbors from that same snapshot. Edges/corners do not react; preserve the six-face neighborhood. Collect the selected commands in stable order and commit through the registered command path. Snapshot selection makes traversal order independent while event/command order remains explicit.

Initial composition contains one pre-score reaction step and one post-score reaction step. Selection has no automatic within-step fixed-point rescan. New state from the pre-score step is visible to scoring and to the post-score snapshot in the SAME play. A post-score change cannot recursively rerun that already completed material step; it affects the next play unless another explicitly documented registered command/step reacts to it. This is a deliberate initial bound, not a ban on future composed follow-up behaviors.

The same block may undergo distinct eligible pre/post changes because the phase snapshots differ. An individual registered reaction selection is applied at most once per source block per configured step/action, and duplicate delivery cannot reapply it. Existing cooking remains one post-score advancement per play, regardless of heat-source count. Do not turn a step-local safeguard into a global changed-this-play flag that suppresses valid later-phase changes. No-op transformations produce no success fact, use consumption or transition sound.

Example: Air beside ordinary Flame upgrades it in the pre-score phase. Scoring observes that resolved state. Nearby Water sees the aggressive Flame in the post-score snapshot and becomes boiling Water in this same play. Its new boiled bonus affects subsequent scoring, not the already finalized lines. If boiling Water was created during the post-score step, cloud generation in that same snapshot does not retrospectively see it; it waits for the next relevant step/play. Additional explicit trigger/command chains are still possible through registered behavior and share the budget.

The existing action-wide limits remain 128 ordinary delivered events and 4,096 combined handler/command/trigger operations. Nested commands/trigger traversal do not reset budgets. Preserve registered trigger visited protection and FIFO fact delivery outside its documented depth-first internal traversal. Overflow or command failure rolls back the entire action state/RNG and publishes no partial successful outcome; never silently truncate model consequences or use a device-speed timeout. All phases publish immutable correlated facts only after successful commit.

## Scoring and presentation

Reactions do not themselves add score unless a separately configured gameplay rule explicitly awards it. Pre-score transformations can alter the one ordinary score calculation; post-score transformations cannot rewrite finalized rows, apply their new bonuses retroactively or request an implicit rescore. Trial hand evaluation remains pure and cannot trigger reactions or effects. The topology passive's eventual final-row contribution must use the scoring snapshot, not a later post-score shape.

Narration consumes captured records in the same order: placement/opening, pre-score consequences, scoring, post-score consequences, final outcome cue and result-scene entrance. The model resolves promptly; visuals can unfold over configured game-time units and the player can make valid moves while they catch up. Every timed effect uses the shared scheduler and captured payload, without reading newer live state. Material changes use the target-defined sound response contract; reaction.applied describes a committed consequence but does not independently duplicate the transition audio. Restore sets current state without replaying reactions or sounds.

## Evidence and verification

The pre-existing doc/game-events.md already places the Air upgrade before scoring and reactions/detonations afterward. Legacy doc/game-architecture.md and src/reactions.ts commentary describe a single post-score snapshot and a two-play Air→Flame→Water chain. That is the documented contradiction the owner resolved in favor of phased consequences. src/reactions.ts already has timing configuration; registries and command buffering are the reusable seams, not grounds for material branches. Draft PR #861 is implementation evidence to reconcile, not an approved substitute for this contract.

Verify the same-play Air/pre-score→Water/post-score example, post-score changes not altering finalized scores, delayed visibility of a change within the same snapshot step, first-match priority, cooking once, multi-placement opening before pre-score, countdown-before-score/detonation-after, stable event order, loop/budget rollback with RNG, no reaction on mere restore/discard, and input remaining available during old narration. No unbounded automatic recursion or new physics simulation is approved.
