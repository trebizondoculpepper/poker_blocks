# Library-backed visual scheduler proposal (#557)

Research decision, 2026-11-11. This is documentation for future implementation, not a claim that the queue or dependency has shipped. It revises #543's provisional no-dependency preference following the owner's explicit request to use an existing library.

## Recommendation and package identity

Use **`tinyqueue` 3.0.0**, the `mourner/tinyqueue` priority queue, behind the game's visual scheduling service. It provides a compact binary heap with a comparator, `push`, `peek` and `pop`, ESM and TypeScript declarations, under ISC. Supply `(dueTime, insertionSequence)` ordering: heap priority alone does not guarantee equal-time stability.

“TinyQ” is ambiguous. The separately published **`tinyq` 1.0.1** (`noodlehaus/node-tinyq`) is a Node callback job queue, published in 2012. It is not the browser priority queue recommended here. Do not install `tinyq` because the names sound alike. TinyQueue 3.0.0 was published in July 2024; low release frequency is a maintenance consideration, not proof of either abandonment or correctness. Pin the package and test its small API.

The exact distributed TinyQueue JavaScript inspected was 1,692 bytes unminified; the package registry reports 4,937 unpacked bytes including declarations and other files. Neither is a measured compressed Vite bundle cost. Inspect the actual lockfile and representative production build when installing it.

## Alternatives and boundaries

| Candidate                                 | What it supplies                                                                             | Decision                                                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TinyQueue 3.0.0                           | Comparator-based heap, typed ESM; no clock or lifecycle                                      | Recommended primitive; adapt it rather than reimplement heap ordering.                                                                                   |
| `@datastructures-js/priority-queue` 6.4.0 | Typed queue with heap dependency and predicate removal; inspected distribution uses CommonJS | Viable larger API. Its predicate removal drains and reinserts entries; it is not constant-time cancellation. No advantage for this narrow interface yet. |
| `p-queue` 10.0.0                          | Promise-task concurrency/rate limiting; current package targets Node >=22                    | Wrong abstraction for frame-driven visual starts and active-effect completion. Do not substitute wall-clock task throughput for presentation time.       |
| Tween timelines                           | Interpolation and authored animation sequences                                               | Useful inside effects, not ownership or backpressure for all game presentation. Tween recommendation is #556.                                            |

A heap is **not a complete event scheduler**. Library adoption removes priority-queue implementation work, not the game's need to define cancellation, bounded dispatch, snapshot ownership or completion scopes. The adapter supplies those generic lifecycle concerns without naming cards, materials, scenes or modes.

## Proposed service contract

Expose scheduling of immutable event descriptions, cancellation by handle/scope, an injected-clock `update(nowMs)`, scope completion observation and disposal. Event data carries an opaque handler key, captured payload, run generation, play/scope identity, due timestamp and monotonic insertion number. Registered handlers interpret payloads and return bounded effect lifecycles; the scheduler never switches on event identity to choose behavior. The schema and concrete interface are finalized by #541/#545 before #546 begins.

Use one presentation clock shared with interpolation. A game-time unit is 1/15 second; initial rack start spacing is two units. Absolute scheduled times and effect progress use the same continuous clock, independent of rendering frame count. Recommend pausing this clock while the document is hidden, with an explicit resume policy; do not accidentally combine the frame loop's capped delta with wall-clock due times. Web Audio remains responsible for audio timing, using registered SFX requests rather than per-frame sample playback.

At each update, peek/pop due entries in `(dueAt, sequence)` order. For a late frame dispatch due work in order within a finite budget; do not invent a minimum time interval. Handler enqueue is permitted through the same service. It must not recurse into another update, and newly scheduled due work shares the budget. Repeated immediate descendants must not bypass a per-scope safety bound. Starting effects does not require waiting for the previous effect to finish: a 450 ms pulse can overlap subsequent starts spaced 133.333 ms apart.

A scope tracks pending starts, active effects and descendants. Removing the last heap item is not completion while a tween or child effect still runs. Register descendants before settling parents; complete or cancel each effect exactly once. Ambient grass, rocking, continuously emitted smoke and laser noise do not keep a play completion scope open indefinitely. Model-permitted moves remain interactive during feedback. Result presentation may await bounded relevant scopes after authoritative scoring and material actions finish.

TinyQueue has no arbitrary delete API. Keep pending events addressable in the adapter and compact/rebuild the heap on cancellation using a fresh array, or use canceled handles with an explicit compaction bound. Never retain unlimited canceled payloads/timers. Rebuilding is O(n) for this heap implementation; it is a proposed cancellation trade-off, not an indexed-heap guarantee. Clear scoped active effects through their own disposal handles. Do not mutate heap priority fields or its internal array after insertion. Invalid timestamps and disposed generations are rejected through uniform validation.

Choose finite limits for queued entries, active effects and work per update in #545, with synthetic-load evidence and a documented fallback before implementation. Admission failure cannot lock input, corrupt a scope count or silently erase a score outcome. Recommend collapsing presentation to a captured summary via the producing trait's explicit fallback when admission fails, while optional decorative work can be omitted under configured policy. The scheduler must not hard-code score/decorative categories. Test failure after partial child admission so completion cannot hang. No runtime tuning values are asserted by this research.

## Model and trait responsibilities

Gameplay commits immediately and emits immutable outcomes. Registered controller/effect traits request visual work; they can compose tween, sound, particle and label services. Delayed handlers may only present those outcomes. They cannot roll session RNG, evaluate poker hands, transform/remove cards, make purchases or overwrite newer authoritative state. A later play cannot change an earlier event's payload through shared mutable references.

`staggerEvents` schedules a captured sequence at t, t+2 units, t+4 units, using this service; it is not a second timer queue. Scheduler scopes outlive any single rack animation, and cancellation on a new run/scene exit releases all handles without reversing gameplay. Queue contents are not saved: Continue restores authoritative model state without replaying scoring or reward events.

## Migration and gates

1. Merge research documentation #557; incorporate this package decision in #541 architecture and #545 concrete contract. The existing #543 report remains background evidence, with its no-package preference superseded.
2. #546 implements the library-backed scheduling adapter and controlled tests, without migrating production behavior first. Pin `tinyqueue` during that implementation, not this documentation PR.
3. #547 migrates scoring, #548 flights/discards and #549 exits using existing effect implementations. Keep ambient simulation outside the queue; remove only the replaced scheduling machinery.
4. #542 implements the generic stagger trait after the queue contract, then #540 integrates the rack. Tweening follows #556's narrow interpolation service recommendation; the queue can support non-tween effect lifecycles too.

The shared queue must remain blocked until the research documentation and architecture/interface gates merge. Do not start a bespoke heap implementation while those decisions are pending.

## Verification and evidence

An isolated Node probe of published TinyQueue 3.0.0 passed chronological ordering, insertion-sequence tie ordering and empty pop. This checks the heap primitive, not the proposed adapter. Implementation must test injected time, late frames, reentrant/nested enqueue, bounded descendants, multiple plays, cancellation before/during effects, active completion, overload fallback and scene/run disposal; also verify that delayed feedback cannot mutate model/RNG or gate valid input.

- [TinyQueue repository](https://github.com/mourner/tinyqueue), [published metadata](https://registry.npmjs.org/tinyqueue/3.0.0), [versioned source](https://unpkg.com/tinyqueue@3.0.0/index.js) and [types](https://unpkg.com/tinyqueue@3.0.0/index.d.ts).
- [Different TinyQ package metadata and README](https://registry.npmjs.org/tinyq/1.0.1).
- [Priority-queue metadata](https://registry.npmjs.org/@datastructures-js%2fpriority-queue/6.4.0) and [versioned removal implementation](https://unpkg.com/@datastructures-js/priority-queue@6.4.0/src/priorityQueue.js).
- [p-queue repository](https://github.com/sindresorhus/p-queue) and [versioned metadata](https://registry.npmjs.org/p-queue/10.0.0).
- Local baseline `f50b10bb56a8e7af4f7cff06c3f10126cd074af7`: `src/play-presenter.ts` score-step scheduling, `src/visual/exit-presentation.ts` update/finish/dispose contract, `src/main.ts` frame loop and `src/core/emitter.ts` synchronous events. This proposal coordinates those mechanisms rather than turning the core emitter into a delayed gameplay bus.
