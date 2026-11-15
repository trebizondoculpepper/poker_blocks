# Appearance-owned scoring feedback (#1392 / #1361)

This is the target contract for correcting scoring tint on shader-based and authored-color appearances. Gameplay scoring and scheduler ordering are unchanged. Implementation follows this document's separate merge.

## Evidence and decision

Source audit at `73d654f6`: `src/field-view.ts:createFieldView().update` walks `tint.blocks[].materials` and calls `material.color.setRGB(1, 1, 1).lerp(...)`. This assumes a standard material channel that custom shader appearances need not expose, and it replaces authored base color with white. The first defect can interrupt the render loop; the second makes restoring color incorrect even for standard materials. `src/visual/selection-feedback.ts` already provides registered appearance-owned bindings, authored-baseline capture and overlay feedback; `src/visual/block-appearance.ts` owns assembly construction. These are the reuse seams. This is a source finding, not a visual acceptance result.

Adopt the same ownership pattern for scoring feedback. A generic material-property guard avoids a throw but silently drops the cue and leaves material policy in a shared view. Forcing all assemblies to standard materials would break their rendering. Registered appearance capabilities preserve both the cue and custom rendering without identity branches.

## Binding and composition

Each admitted appearance declares a registered scoring-feedback provider and configuration. At mount, the builder/provider binds only resources that the appearance owns. The binding accepts a color and normalized strength, removes that contribution, and disposes its own resources. Generic field/view code publishes those values through the binding; it never inspects material identity, class, property presence or trait flags.

A standard-material provider captures its authored baseline; a shader/contained assembly declares a compatible uniform, overlay or composed provider. A geometry overlay can be reused from the selection approach, but must be independently owned and follow the mount's render layers and lifetime. Explicitly configured absence is allowed only with a documented alternative visible cue; missing/unknown declarations are composition diagnostics at binding, not exceptions repeated every animation frame. Failed feedback binding must not prevent rendering, input or scheduler settlement; report the diagnostic once and let the presentation complete safely.

Selection, activation pulse and scoring contributions must not overwrite each other's properties. When they share a property, use one provider-owned composition writer that recomputes from the authored baseline plus the current independent contributions. Do not save an already modified value as a new baseline. Removing scoring tint restores the other active contributions, not white and not a stale snapshot of another effect. Providers never mutate game state, card bonuses or shared cached assets.

## Lifetime and timing

Keep existing captured row targets, tint configuration and required completion scopes. The scheduler controls finite feedback; ambient updates may sample the supplied presentation time but introduce no timer, deadline or parallel queue. This capability does not introduce a narration delay or block the next input.

A mount owns its binding. Material replacement detaches the old binding, binds the new generation and reapplies the current captured visual contribution while it remains active. Removal, reset, cancellation and scene exit remove only that binding's work and settle its scheduler effect exactly once. A disposed/replaced generation cannot receive late writes. Missing targets are a harmless presentation omission; they do not cause rescoring or a draw from model RNG. Captured targets may resolve to current visual mounts through the existing opaque handle registry, without reading live gameplay values.

## Verification and limits

Exercise the real Prismatic Crystal scoring path that reported the crash, a colored standard appearance, and a contained/shader appearance. Verify render-loop continuation and subsequent input, authored color restored after completion, selection/pulse overlap in both activation orders, repeated updates without accumulating brightness, material replacement, removal, cancellation/reset and scene re-entry. Check independent mounts sharing cached assets and exactly-once scope settlement. Supply browser evidence for visible cues; unit tests can prove dispatch/lifetime behavior but cannot establish appearance quality. No broader scheduler migration or new gameplay rule is part of this fix.
