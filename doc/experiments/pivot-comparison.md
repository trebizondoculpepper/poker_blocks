# Centroid versus material-weighted pivot

Planned experiment, #823. Not a production pivot change. The user wants to compare the same placed structure rotating about its geometric centroid versus a density-weighted center of mass. Related delivery: #824 queries, #825 room, #816 physical mass aggregates, #826/#827 composable deck builders. All implementation waits for its applicable documentation and capabilities to merge.

## Definitions and physical approximation

For occupied block centers p_i in grid coordinates, centroid = sum(p_i)/n. Material-weighted center = sum(m_i × p_i)/sum(m_i), using the same positive authored mass contributions as the material-mass experiment. A high-mass Gold block pulls the result toward its position; it does not necessarily become the exact center. Equal masses yield the centroid. Empty fields return no center and the presentation retains its configured neutral pivot. Invalid/nonpositive total mass is a query/configuration error, not an implicit fallback that disguises missing physics metadata.

Treat each block's mass as concentrated at its cell center. Hollow contents still contribute their configured total shell/content mass; moving liquid, foil thickness, internal particle positions and the rotor are not integrated into an inertia solver. Use plausible sourced real-material densities at stated conditions, explicit assumptions for composites and fictional substances, and the same authored volume reference across consumers. #782 owns that common physical-mass calibration; this experiment must not establish a competing density map.

## Composition and UI

The mode composes a Dev-prefixed pivot-comparison controller and a reusable registered pivot-policy capability. The latter selects a registered pure center query, not a branch on room or material identity. Normal play retains its documented centroid policy. A selector in this bench switches Centroid / Center of mass without replacing cards, resetting the layout, shuffling or changing manual orientation. Label both markers distinctly (with text as well as color), show selected center coordinates, count, total mass and readable individual material/mass contributions. Public data obeys ordinary inspection visibility; hidden payloads cannot be exposed through a weight breakdown.

The model publishes immutable occupied-field snapshots/revisions; queries cache by snapshot/configuration. Controller subscriptions respond to placement, permanent removal, material change, clear and restore through registered lifecycle hooks. Save restoration establishes current centers without replaying historical placements or effects. Service code accepts numeric pivot coordinates and knows neither the selected mode nor card identities.

Pivot changes preserve every block's world pose at the switching instant through the existing counter-translation mechanism; no teleportation or sudden orientation change. Initial bench policy is an instantaneous invisible re-anchor, not a new tween. Subsequent rotation then reveals the different pivot. Any later eased transition must be separately configured in game-time units on the shared scheduler, never introduced through a private timer. Keep rocking speed, rocking amplitude and manual drag behavior equal between A/B trials; mass-dependent rocking-speed experiment #783 is independent and disabled for this comparison by default.

Changing the selector plays the existing suitable UI action sound through its configured control response. Status/center updates alone are silent telemetry. Input remains available while feedback presents. Cover/pause semantics follow the host; controller subscriptions and markers detach on exit, and re-entry cannot duplicate listeners. Reduced motion disables ambient rocking but retains manual comparison and readouts.

## Deck and reproducible trials

Use a configured composable starting-deck builder, invoked by registered run setup. Suggested independent material weights: Paper 70%, Wood 15%, Gold 5%, Steel 5%, Prismatic Crystal 5%; keep rank/suit templates ordinary. These are reversible authoring defaults, not guaranteed exact counts or production stock weights. A finite deck can contain fewer heavy cards than expected, so export the actual initial descriptors. Seed, normalized weights, builder version and operation order are part of trial configuration. Do not implement a second room-specific deck factory.

Allow ordinary play with this deck and compare both policies on the same snapshot. Export settings and outcomes through the common experiment export contract #821; preserve initial state and ordered actions, not just the seed. Capture both calculated centers, selected policy, total mass, composition and block positions per committed move/selector change. A replay should recreate the arrangement and readouts without claiming a camera screenshot is a physics measurement. A scripted comparison fixture with known asymmetric mass can supplement random play; it is not the user's only way to test.

Assess whether the heavy-block pull feels useful, disorienting or excessive, especially near edges and after removing the heaviest block. Compare equal-mass control layouts and opposite balanced heavy blocks. No production promotion is implied by visual preference or a completed run.

## Evidence and checks

`src/center-of-gravity.ts:MassCenter` stores count and coordinate sum; `centerOfGravity` divides by count. `src/field-view.ts` updates this on placement/removal and calls onCenter. Despite their names/comments, these calculate a centroid, not material-weighted physics. `src/camera-view.ts:updateRotationCenter` updates the pivot and counter-translates the assembly to preserve positions. Camera auto-fit and manual sensitivity also use centroid-derived data; this experiment changes only the selected rotation pivot, not those independent policies. Reusing the pivot seam avoids changing scoring coordinates or field ownership.

`src/run-setup.ts` already supplies registry-dispatched deck construction; [deck-builder design](../deck-builders.md) (documentation issue #826) adds a composable recipe behind that seam. Existing [lifecycle research](../research/gameplay-lifecycle-opportunities.md) supports pure snapshot-scoped derived queries. These source findings support the split; they do not establish that weighted-center queries, physical mass or the bench already exist.

Verify equal-mass agreement, exact two-block weighted values, symmetry, count/zero validation, placement/removal/material-change invalidation, restore without historical event replay, world-pose continuity at nonzero rotation and repeated policy switching, pointer/keyboard control, unchanged normal-mode pivot, listener cleanup and deterministic deck/export round trip. No new performance claim is made without measurement.
