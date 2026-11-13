# Outcome facts, effects completion and screen entrance

Owner decisions, 2026-11-13 (#866, implementation #756). Model resolution, the end of a visible consequences sequence and entering a result screen are distinct lifecycle moments. This contract resolves the questions left by the committed-fact audio migration; it does not authorize new rescue gameplay or a post-game progression design.

## Finish the model before presenting it

A validated action resolves placement/opening, pre-score changes, scoring, post-score changes, then stage.outcomeProposed. Registered gameplay outcome commands may affect that proposed outcome before it is finalized. Re-evaluate under the same action transaction and cascade limits, then publish exactly one final outcome and immutable action/presentation records. A future consumed lifesaver might change a proposed defeat, but its threshold, benefit, price and uses are NOT approved here. No screen-enter handler, audio response or animation callback can rescue a finalized loss or issue gameplay commands.

Progression commands such as leaveShop/advance must use the same validated transaction/committed-publication boundary as plays when they change ownership/progression. Record shop.left once on a successful leave, including the outgoing unsold-stock descriptors and the captured destination transition context; a rejected leave publishes nothing. Record run.ended once when the progression command commits a terminal run outcome, with its captured result and originating final stage/action correlation. Stage outcomes and run termination are separate facts; do not infer either by diffing state in a service. Restore does not replay these transactions or pay rewards again.

These facts and their configured response descriptors are recorded by the responsible registered model command/rule handlers. The generic run coordinator only stages and dispatches the configured operations; it contains no sound ID or scene/material identity policy. Scene definitions separately own their enterSound configuration. A new fact family obeys the existing immutable envelope, subscription disposal, command budget and rollback contract in game-events.md.

## Two distinct result cues

The owner explicitly wants BOTH:

1. An outcome cue when the deciding action's required scoring/material-effects sequence finishes: initial IDs round.cleared and round.failed remain suitable for the win/loss sequence cues. The historical round naming does not make them exclusive to ordinal stage three.
2. A separate entrance cue when the configured Stage Won, Game Won or Game Over result scene actually enters. Reuse the registered enterSound trait, never a scene-name switch. Game Over may retain run.lost as its entrance cue; Stage Won/Game Won receive distinct registered entrance IDs/stand-ins as needed. The Game Won cue applies when that scene exists; no new post-game scene/rules are invented by this contract.

Outcome cues are response records on the committed final outcome with registered timing = required-sequence-complete. They do not play at model commit. The presentation controller registers the response with that action's required scope. Once all required descendants finish (or complete through the documented reduced-motion/summary path), it schedules the one outcome-cue request, then permits the result-scene entrance. Starting the cue and then entering the scene are ordered; do not wait for the audio sample to finish. Both cues can be heard and are not de-duplicated merely because they share a placeholder sample. Their intended moments, IDs and response occurrence IDs differ.

A rescue that avoids final defeat emits no loss-sequence cue and no Game Over request. Finalized stage/run outcomes alone do not force a screen while its required sequence is incomplete. Input is never generally refused because feedback is playing; terminal model legality and the existing required-scope transition gate determine which action is valid. Mere clicks or live score polling do not decide success/loss.

Use distinct response occurrence IDs derived from the committed event and configured response registration. Delivery/re-entry retries cannot replay an outcome response. Repeated real scene entry uses enterSound's normal enter lifecycle; covering/resuming the same scene does not simulate another enter. Continue may audibly enter its restored screen, but must not replay the old deciding sequence/outcome cue. Exiting/restarting cancels stale response leases and scene requests by generation. An intentionally cancelled/superseded old action never opens its result scene; normal reduced-motion completion is not cancellation and still gets its outcome cue once.

## Effect and progression sounds

- A successful block.destroyed fact supplies the configured destruction response. Play it at that block's captured destruction-effect start, not at a new live-state lookup. Resistance, discard, ordinary deck return and rejected destruction produce no destruction success cue.
- A successful shop.left receipt captures the stock that actually left. The burn presenter uses those descriptors after model commit and plays shop.stock.burn when the burn sequence starts, once for the configured stock-burn sequence. Empty stock produces no burn cue. The presenter does not remove offers or decide purchases.
- The shop.leave cue follows the registered shop-exit presentation anchor. Model leave/next-stage setup must not await burn audio or visual completion; ownership has already committed. Any outgoing-stock visual ghosts belong to the presenter's own scope and cannot be purchased. Navigation may present required outgoing effects before revealing the destination according to the existing scene transition contract, without delaying the authoritative progression command.

Never play burn first and commit leave only after its awaited animation. No new private timer, presenter queue or model call in a delayed handler is allowed. Audio uses the one scheduler/clock and phase/action anchors, whether an optional visual effect is composed or reduced motion shortens it. Captured action sounds live on operation/response configuration, not a scene-keyed table in the sound service.

## Adapter to existing committedEventSounds

The current trait presents each fact's simple sound field at commit; that path remains valid only for explicitly commit-timed responses. Add registered timing responders for scheduled phase-start, effect-start and required-sequence-complete descriptors rather than making this trait branch on fact names. One response is owned by one path: a delayed response must not also leave an immediate sound field on the same fact. Preserve the existing intentionally grouped coin sound behavior where documented; do not apply global sound-ID de-duplication across unrelated transition events or across outcome and scene-entry cues.

Scene lifecycle owns subscription/start/stop and cancellation. The audio provider knows only a registered sound request, never whether the caller is a shop, stage, material or winner. The model may carry configured response data as a captured consequence, but performs no sound/service call while its transaction is open.

## Evidence and delivery checks

Source audit: game-run-controller.ts:advanceFromStage currently awaits burnUnsold before leaveShop, directly calls shop.stock.burn/shop.leave, and endRun calls run.lost. Its decided callback plays round.cleared/failed when narration reaches the result. src/scene-traits/committed-event-sounds.ts presents configured fact sounds at commit; src/game-modes.ts already has enterSound/exitSound traits. src/audio/sfx-registry.ts contains the current IDs. game-events.md already exposes stage.outcomeProposed and required presentation scopes. These establish ownership seams and explain why a blanket move of all five cues to commit would change intended timing.

#756 implements the transaction/fact and audio migration behind this merged contract; #547 supplies the shared score narration scope integration. Keep implementation slices small if the combined change cannot be reviewed independently. Verify final outcome after rescue proposal, once-only stage/run facts, failed-command silence and rollback, sequence cue before entrance, separate IDs/placeholder behavior, no audio-finish gate, reduced motion, stale/cancel/restore cases, stock captured at commit, and input/model progressing while old feedback runs. No new sound assets, rescue rule or actual outcome handler is implemented by this documentation.
