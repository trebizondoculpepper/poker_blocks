# Result entry from terminal facts and required scopes (#1389)

This closes the remaining result-deadline migration in #544. It refines implementation ownership, not scoring, rewards or the owner's accepted outcome sequence. Implement separately after this documentation merges.

## Evidence and choice

Audit at `bba7eda7`: `src/game-run-controller.ts` still stores `stageWonAt` and `gameOverAt`, adds 900/1400 milliseconds in `decided`, adds a 400-millisecond win delay on resume, and checks `presenter.busy` in `followOutcomes`. `holdResult` also supplies controller-owned holds. The shared scheduler already supplies action scope completion, and the architecture's “Result screens” contract requires terminal model plus required scopes. [Loss-field burn](loss-field-burn.md) supplies the explicit later 80-percent gate. The deadlines are an implementation gap, not an extra owner-approved pause.

Choose completion references, with **no additional automatic pause** after required presentation finishes. A future deliberate pause must be separately configured in game-time units through the shared scheduler and documented as a presentation decision. Do not translate the old millisecond constants into new scheduler events merely to retain accidental latency. A second presenter queue or polling a global busy flag would preserve the ambiguity; terminal action scopes identify exactly which work must finish.

## Composition and lifecycle

A configured outcome-presentation controller captures the committed terminal outcome, action identity, generation and required completion references. Model commands decide the result immediately; the controller cannot award points, decide rescue eligibility or infer the result by diffing visual state. Generic navigation receives the configured destination/action and readiness reference, without learning an outcome, phase or scene identity. Existing gameplay branches are migration seams, not a precedent for new ones.

Result entry is eligible only after the captured action's required scoring/material/presentation scopes finish, plus any separately documented required exit gate. Ambient work, unrelated newer actions, sound sample duration and the optional loss-burn tail do not hold it open. Preserve the loss sequence: required terminal-action feedback, then captured field burn/music wind-down, then result entry after ceil(0.8*N) burns complete. The remaining burns continue under their outgoing-root lease. Do not nest optional tail work beneath the required gate.

An end-of-effects outcome cue and the destination's own entrance cue remain distinct, with their existing occurrence deduplication and registered owners. Opening the result does not wait for either audio sample to finish. This migration must not restore the removed stage-start jingle or duplicate outcome sounds.

Covering the game suspends result navigation without replaying model actions or cues. If readiness settles while covered, resume presents the still-current result once, without a synthetic 400-millisecond delay. Restart, new run, owner disposal or superseding generation cancels the pending navigation and releases every subscription/hold; a late completion cannot open an old screen. Required effects must have bounded failure/cancellation policies and exactly-once settlement. Failure reports a diagnostic and uses the documented bounded summary/fallback; it never leaves a permanent hold. A cancelled obsolete generation never presents its captured outcome.

## Delivery and verification

One focused runtime task replaces the deadline/busy-based result gate with action-scoped readiness and cleans its obsolete timestamps/constants. Preserve current scene commands, burn controller, rescue hook and cue ownership. #544 becomes a migration tracker; rack stagger #542 can proceed against its actual shared-scheduler prerequisite #546 rather than this unrelated result migration.

Use an injected presentation clock and explicit scope handles to verify completion before/after terminal decision, required child settlement, optional ambient/tail work, zero-card loss, the 80-percent threshold, cover/resume, reset/new run, cancellation and failed-effect fallback. Verify one result and each appropriate cue once, model scores/rewards unchanged, and input remains responsive. Browser trial verifies the visible transition; source audit and deterministic tests alone do not prove visual pacing. No assumed wall-clock deadline is an acceptance oracle.
