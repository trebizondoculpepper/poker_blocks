# Tweening library recommendation (#556)

Research decision, 2026-11-11. This document specifies a future integration; it does not claim that a tween service or dependency is installed.

## Decision

Use **`@tweenjs/tween.js` 25.0.0** behind a narrow presentation service for finite numeric interpolation. It is ESM, supplies TypeScript declarations, uses the MIT license and accepts explicit timestamps. Its manually updated `Group` suits the existing frame loop. Keep the existing `springAnchor` integrator for responsive, physically damped motion; a fixed-duration eased tween is not a replacement for a spring receiving repeated kicks.

The proposed service supplies interpolation, not gameplay policy or a second event scheduler. Configured effect/controller traits select endpoints, easing, duration, mount and interruption behavior. Generic services never inspect material, item, scene or mode identities. The visual-event scheduler determines when an effect starts and tracks its completion; Tween.js supplies the changing numeric values while it runs.

## Alternatives examined

| Candidate | Published version checked | Fit and trade-off                                                                                                                                                                                                                     |
| --------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tween.js  | 25.0.0                    | Recommended: small scope, manual clock, numeric objects, typed ESM, MIT. Requires application ownership and cleanup.                                                                                                                  |
| GSAP      | 3.15.1                    | Rich timelines and overwrite controls; useful for elaborate authored sequences, more capability than the present numeric interpolation need. Has its own ticker to integrate and a custom Standard No Charge license rather than MIT. |
| Anime.js  | 4.5.0                     | Typed modular animation engine, MIT; manual engine operation is available. Its DOM/animation facilities and engine are broader than required here.                                                                                    |

Registry package unpacked sizes were 223,658 bytes, 6,274,260 bytes and 2,126,307 bytes respectively. These include packaging and ancillary files: **they are not download or production bundle sizes**. Measure a representative Vite build before adopting; no browser/GPU performance ranking was established. No paid GSAP subscription is assumed in this comparison.

Check published versions again when implementing and lock the chosen version. Do not copy newer website APIs into an older release: the inspected Tween.js 25.0.0 ESM exports `Tween`, `Group`, `Easing` and `Interpolation`, but **not `Timeline`**, despite newer upstream documentation describing one.

## How it integrates

One presentation clock, advanced by the existing render loop, drives both scheduling and interpolation. Define the clock's pause/visibility/speed behavior in #541/#545; do not mix wall-clock timestamps with accumulated clamped deltas. Convert game units to milliseconds only at the service boundary: one unit is 1000/15 ms, two are approximately 133.333 ms. Future speed settings scale the shared presentation clock rather than every effect independently.

An adapter can expose `start(spec, scope)`, `update(nowMs)` and an idempotent cancellation handle. `spec` holds a presentation-only numeric value object, captured endpoints, duration, easing and an apply callback. This is a proposed contract, not an existing API. Scheduler and trait code depend on that narrow interface; only its implementation imports Tween.js.

For the inspected release, explicitly add a tween to an owned `Group`, call `start(nowMs)`, then `group.update(nowMs)` each frame. Its default group update preserves completed members. Remove each tween on completion; on cancellation call `stop()` and remove it. Clearing a group alone does not constitute application-level cancellation or scope completion. Natural finish and cancellation must each settle the effect handle exactly once, release captured mounts/listeners and detach group membership. Late callbacks from disposed generations do nothing.

Do not add scheduler descendants directly from library callbacks without going through the scheduler's enqueue API and dispatch budget. Tween.js can process group additions in batches during an update; unbounded callback-created additions would evade the scheduler's safety rules. Avoid its global default group, implicit `now()` and self-owned animation loops.

Each effect owns a transform layer or numeric channel. Spring anchor, hover/press, flight and pulse cannot all write the same Object3D position/scale. Reuse the existing outer/inner mount approach in `src/traits/spring-anchor.ts`; implement explicit interruption in the owning trait. Fly-back can capture the released pose and interpolate progress for approximately 500 ms; rotations use quaternion interpolation from that progress, not independent Euler-angle tweens. A fresh interaction cancels/releases its prior channel without locking input. Ambient rocking and simulation remain per-frame behaviors, not hundreds of scheduled tween events.

Reduced motion selects a shorter or immediate visual path through configured presentation policy. It still completes the effect handle and does not skip model outcomes. Sounds remain registered presentation events; a tween callback never awards points, rolls RNG, buys, removes or transforms a card. The model commits immediately and later valid plays remain possible.

## Implementation acceptance

Before migrating a production effect, verify injected-clock progression, exact-once finish/cancel, membership removal, disposal before a late frame, overlapping effects on separate channels and interruption from a released pose. Compare the chosen effect visually and measure its production bundle contribution. Do not require a full animation rewrite to adopt the service. Library installation and runtime integration require a separate implementation mission after this documentation merges.

## Evidence

- [Published Tween.js 25.0.0 metadata](https://registry.npmjs.org/@tweenjs%2ftween.js/25.0.0) and [versioned ESM implementation](https://unpkg.com/@tweenjs/tween.js@25.0.0/dist/tween.esm.js): exports, group retention, explicit time and stop/remove behavior.
- [Tween.js user guide](https://tweenjs.github.io/tween.js/docs/user_guide.html): general interpolation and manual update model; verify examples against the pinned release.
- [GSAP metadata](https://registry.npmjs.org/gsap/3.15.1) and [license](https://gsap.com/standard-license/).
- [Anime.js metadata](https://registry.npmjs.org/animejs/4.5.0) and [manual engine update](https://animejs.com/documentation/engine/engine-methods/update).
- Local baseline `f50b10bb56a8e7af4f7cff06c3f10126cd074af7`: `src/main.ts` frame loop, `src/traits/spring-anchor.ts` layered physical motion, `src/motion.ts` continuous rocking, `src/visual/exit-presentation.ts` effect lifecycle.

A disposable Node probe of the published Tween.js 25.0.0 ESM passed linear halfway interpolation at an injected timestamp, single completion after later updates, and stop/remove cleanup. It was run outside the repository and is not a production integration or browser performance test.
