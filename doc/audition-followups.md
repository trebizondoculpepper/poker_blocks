# Owner audition follow-ups, 2026-11-14

This document records target presentation and tools, not claims of shipped fixes or accepted final assets. It supplements [presentation contracts](presentation-contracts.md). Runtime PRs follow this merged document and retain focused issue boundaries. No gameplay changes are authorized here; D12 rules have their own design.

## Observations and bounded fixes

**Fire (#744).** Fire, Aggressive Flame and the Fire transmogrifier show unwanted shiny highlights at some rotations. Flame in a lantern looks good for this check. Compare those actual composed layers to isolate the cause; the unlit shader alone does not establish a reflective flame root cause. Keep existing emission/extinction target, legitimate shell lighting and shared artwork consumers. Do not rewrite the accepted lantern look blindly.

**Earth grass (#765).** Falling/receding soil must carry its grass with the moving surface, not leave blades suspended in air. Rising soil buries blades; partial cover preserves visible portions and only complete burial deletes a blade. No-deletion on falling does not mean a fixed stale world position. This refines the existing surface-anchor ownership; use shared contained-surface queries.

**Residue (#1010).** Custard in a frame clings and fades correctly but its coating looks blocky. Preserve local wetting/fade behavior; investigate grid resolution, filtering and representation before choosing a fix. A costlier replacement representation needs evidence/design first, not an unmeasured texture-size increase.

**Dust (#1011).** Earth with dust (audition) showed no dust even under drag rotation. Trace preview pose/angular-motion input separately from particle emission and visibility; do not force always-on emission or infer success from stationary screenshots.

**Ice (#1001).** Rougher, less uniform edges are the requested direction. Meat's irregular geometry is a candidate to reuse, not proof of suitability. Audit the existing builders before selecting a bounded deterministic shape capability. Preserve grid/hit semantics, lettering, optical readability, shared Ice artwork consumers and destruction behavior. No per-frame static-geometry regeneration. A source-backed geometry decision still precedes implementation.

## Flame Bench (#1008)

A trait-composed bench compares regular and aggressive configurations of the ACTUAL production flame presentation side by side with identical camera/light/background and reproducible cosmetic seed. Independent controls cover scale, world-relative base, colour/emission, motion and smoke where the real effect supports them. Layer visibility controls isolate container/frame/content to diagnose the #744 discrepancy. Add an ordinary inspectable comparison preset for the accepted lantern composition; do not infer behavior from display names. Controls come from registered parameter descriptors with finite ranges on their own definitions.

Each preview owns its tuning and live simulation; defaults are immutable and edits never mutate production definitions or another preview. Existing appearance updates and render requirements are host-dispatched. Rotation is through the shared preview/gesture adapter; reduced motion and disposal follow existing tools. Copy Settings emits a versioned plain configuration (effect/preset handle plus effective parameters), with explicit clipboard failure and selectable text fallback. Export no meshes, uniforms, clock phase or live handles. Applied values are validated through the same descriptors; unknown controls are reported rather than silently dropped. A selected configuration does not automatically promote to production.

Initial parameter ranges are derived from the existing production effect's valid configuration, not invented as approved tuning. Missing controllable behavior is a concrete implementation seam to document, not an excuse for a fake preview. Keep per-preview shared resource ownership, repeated resets/switches, rotation/release, responsive access and shader cost inspectable. Owner will choose regular/aggressive settings from exported configs and later approve the shared definition update. Split reusable parameter/preset/export capability from room composition; #744 remains a focused correctness fix, not gated on finishing the bench.

## Object browser and listening access (#1007, #1012)

Add a labelled search input filtering the active category by case-insensitive display-name/ID substring. IDs are searchable opaque data, never behavior selectors. Clear and no-results states are explicit; filtering does not destroy the current preview unexpectedly or mutate catalogue content. Preserve keyboard/touch navigation and the selected object's rotation state while it remains selected. A search does not make an unregistered experimental variant appear: expose intended audition entries through configuration, or report their absence.

Dev9 Sounds currently lists registry metadata, not an audio player. Each selected sound gets an explicit labelled Open in listening room action to the same-origin `/sfx.html?sound=<encoded-id>`, plus concise explanation. Reuse the dedicated room's sample/synth/stand-in player, unlock, mute and readiness handling. No duplicate audio engine. Clicking a catalogue item alone should not surprise the user with autoplay. Controls use the existing console/browser accessible DOM patterns; no room-specific branches in generic input.

## Passive artwork (#1009, #1004, #1005, #1002, #1014)

- Light: feather. Heavy: anvil. Mean: one object; Total: a tight cluster of three. Keep Mean/Total in names and inspection text. Distinct silhouettes must survive reorientation, unlike the rejected up/down arrows. Preserve experimental status and mass queries/curves.
- Ace Exchange: a round bin with two recognizable Ace cards protruding. This changes artwork only, not discard/reward semantics.
- Seeing Red: red suit icons instead of white, preserving shapes and contrast.
- D20: numbers fit inside triangular faces with consistent margins; key lines follow actual geometry edges. Owner is sourcing replacement models for all dice. Record selected source/license/credits and low-poly preparation before committing assets; a new set does not authorize die rule changes except separately documented D10→D12.

All appearances live in configured shared artwork builders for rack/shop/inspection. No named-passive checks or per-consumer independent icon copies. Verify actual rotated small-scale readability and input/hit bounds. Source models still await user supply; do not mark imported asset work ready by implication.

## Evidence and limits

Source audit: `src/tools/object-browser.ts` builds categories/previews and metadata-only Sounds; `src/tools/preview-rotation.ts` owns manual preview rotation. `src/tools/listening-room/main.ts` already implements the playback/readiness path. `src/visual/fire-core.ts`, configured flame visuals and `doc/presentation-contracts.md` distinguish emitted content from shell lighting; owner comparison is evidence of a visual discrepancy, not a shader diagnosis. `src/visual/rising-bubbles.ts`, contained surface queries, current grass and residue components own reusable behavior. `src/passives.ts` and shared passive visual builders own artwork definitions. Exact new model geometry, residue technique and flame controls still need bounded implementation audits. No performance, visual acceptance or real-device touch verification is invented here.
