# Score narration: completion scopes versus inferred deadlines

Research and selected contract for #999/#1018, owner discussion 2026-11-14. Audited main revision `aebd6375b930d9baf78960da91fc81cb8fc47022`. This report does not claim a runtime fix or new benchmark. The owner explicitly accepts imperfect explanatory narration timing/display; prioritize useful feedback, correct gameplay, working result transitions and no stuck queue/input lock.

## Findings

The scheduler already exposes `createScope`, `seal`, `observe`, `status` and cancellation in `src/visual-events/scheduler.ts`. `settleIfDone` requires a sealed producer, zero pending and active events, and no pending child scopes. `finishEntry` disposes its effect and decrements counts before settlement. `observe` reports an already-terminal scope immediately; cancellation, failure and success are distinct. `EffectHandle.update` supplies running/finished, not a guessed external callback delay. These are implemented semantics, already specified in [the interface](../visual-event-interface.md).

`src/score-narration.ts:createScoreNarration` uses scope observers for line-queue advance and outcome completion, but ALSO owns `settledAt`, assigns it from the last line's due time plus `timing.settle`, then schedules the outcome using `max(0, settledAt - nowUnits())`. `reset` clears waiting/current/outcome but not `settledAt`. This is a second completion ledger with independent reset rules. `src/play-presenter.ts` supplies `lineStep` and `settle`, and reports late starts to keep field tint timestamps aligned. `src/field-view.ts` still renders tint from its configured lifetime; a completion observer is not proof of actual GPU presentation.

Thus the owner's diagnosis is partly supported: inferred completion/deadline bookkeeping causes this concrete defect and several tail-timing edge cases. It does NOT explain all historical review findings. Earlier live-state score capture, landing-versus-commit queue ordering, hidden-tab notification and HUD refresh after scope settlement were separate concerns. Replacing deadlines cannot waive those contracts.

## Reproducible probe

At the audited revision, `npx vp test run src/score-narration.test.ts` plus the following temporary test passed **17 tests**, including this assertion of the existing BUG. Use the file's existing `narrating`, `play` and `line` helpers, which drive the real scheduler with injected time; there are no sleeps or browser dependencies.

```ts
it("reproduces a cancelled run's stale tint deadline", () => {
  const { log, narration, advance } = narrating();
  narration.narrate(play([line("old", 1)]));
  advance(10);
  narration.reset();
  log.length = 0;
  narration.narrate(play([], 0));
  advance(10);
  expect(log).toEqual([]); // BUG: new empty play still waits
  advance(500);
  expect(log).toEqual(["400:outcome"]); // deadline belongs to cancelled play
});
```

The fixture uses two-unit line steps and a six-unit tint tail (400 ms), not a claim about final production tuning. After the fix, invert the regression: the new empty play announces on the next dispatch without inheriting the cancelled tail. The temporary probe was removed from runtime sources after recording; no runtime test/code change is bundled here.

## Selected contract

Put the tint tail on the shared scheduler as declared work. A committed-play slot remains reserved before flight/landing, preserving queue order. Its narration scope controls line spacing and when the NEXT play may narrate. A separate required hold scope accounts for its tint/required feedback tail; it is not a child whose settlement would extend the per-play line-spacing gate. Both belong to the action/generation's owned presentation work and are cancelled on reset. This uses existing scopes, not another queue or clock.

A registered finite hold effect uses the shared scheduled start and configured duration in game-time units. Where an effect already provides its real completion handle, retain that handle/lease instead of predicting completion separately. For today's finite tint, the hold is the scheduler-owned lifetime declaration; ordinary duration calculation within that effect is valid. Remove presenter `settledAt` and outcome delay arithmetic. Scopes are completion evidence for the effects they actually own, not a promise that pixels or unrelated animations finished.

When all committed narration slots are drained, no line scope is running and all required holds have settled, enqueue the captured latest outcome immediately. Empty plays add no hold and cannot erase an earlier live hold. A newer play can reserve work while holds remain; it cancels only the superseded pending outcome, not earlier required feedback. No live GameRun reads, rerolls or delayed model mutation. HUD refresh happens after the outcome scope itself settles and presenting becomes false.

Listeners can run synchronously on registration for already settled scopes. Initialize bookkeeping and epoch before sealing/observing; remove a settled handle before attempting the final gate. Reset increments epoch and detaches/clears owned handles before cancelling, so reentrant observers cannot enqueue an old outcome or affect a new generation. Unsubscribe/release scope references on disposal. Check schedule/admission results for holds/outcome. Failure/timeout uses the captured bounded summary policy, releases every required gate exactly once and cannot wait forever; cancellation from reset does not announce a result. Avoid a required hold that can be admitted without an owned cancellation path.

## Alternatives and validation

Clearing `settledAt` on reset is the smallest patch, but retains two competing completion ledgers. Holding each entire narration scope through tint settlement is simpler but serializes later plays behind the full tail, changing the owner's desired pacing. A new scheduler/library is unnecessary: existing observer/lease support supplies the needed primitive. Per-event/frame notifications would add work without improving this finite completion boundary.

Retain line spacing and last-line-tail tests; add scored→empty play, reset→empty play, later play landing first, long/late frames, hidden/resume, admission rejection, timeout/summary, repeated reset and reduced-motion cases. Check every terminal status, synchronous observation, no duplicate outcomes, late epoch callbacks and pending/active resources returning to zero. Model score/RNG and legal input must stay unaffected. Use a browser clip to verify practical readability, not a demand for frame-perfect explanatory feedback. No production performance or browser result is established by the injected-clock probe.
