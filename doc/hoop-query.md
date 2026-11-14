# Face-connected hoop query

Selected target for #884, runtime #885 and provisional passive #886. Owner decision: FACES ONLY. This contract builds on [the merged research](research/hoop-query.md), its [probe](research/hoop-query-probe.mjs) and [results](research/hoop-query-results.json). It does not certify In the Loop for normal play or claim a production query is already implemented.

## Geometry and result

Request a pure registered whole-field query over the immutable authoritative occupied-cell snapshot. Include all actual field-owned blocks, including temporary/generated and unopened blocks occupying cells; exclude hand/deck/discard/shop, drag ghosts and fading presentation remnants. Material, mass, rank/suit and shader geometry do not affect this query. Camera rotation does not change model coordinates. Cache by snapshot identity/revision, explicit scope and fixed query-limit configuration, not by a room/material name. Repeated scored rows in one snapshot share the result.

A qualifying hoop is an independent loop/through-tunnel of the occupied solid under face-connected geometry, including a simple flat ring surrounding empty space and a deeper/bent tunnel. Edge-only or corner-only contact cannot close it. A sealed cavity alone is not the objective. A solid 2×2 slab has a cycle in its adjacency graph but no geometric hole and must return false. Empty and one-cell fields are available with hasLoop=false. Extra holes/depth do not strengthen the passive.

The query returns an explicit available result with a boolean hasLoop, or an unavailable result with a stable reason, configured limits and input-size diagnostics. Optional complete b0/b1/b2/chi values are inspection/research diagnostics, not reward operands. Never return an incomplete numeric count as though it were the full result. Invalid occupancy invariants (duplicate field cells, noninteger/unsafe coordinates) fail validation; do not silently deduplicate an invalid authoritative field.

## Selected algorithm

Use the dependency-free face construction demonstrated by the research probe:

1. Validate cells and input limits before allocations. Form sparse occupancy indexing; translations and 90-degree axis permutations must not change eligibility.
2. Refine the grid by factor three, filling a 2×2×2 block per original cube and the shared-face bridges. A between-cell refined voxel is filled only when every original cell spanning it is occupied, as in the probe's refine function. This leaves a gap at edge/corner-only contact. Filling shared edge/vertex refinements only when all incident original cells exist avoids inventing new contacts.
3. Treat the refined voxels as a closed cubical complex. Count distinct vertices, edges, faces and cubes to obtain chi=V−E+F−C. Determine its connected components with the closed/refined 26-neighbor convention; count cavities using its dual 6-neighbor empty-space convention. Original face-connected foreground is not permission to mix an unrefined Euler count with a different background flood convention.
4. Sum sealed-cavity counts over each refined component's padded bounding box, consuming one shared volume budget. Each flood treats only that component as solid; all other components are excluded even when they lie inside its padded box. Thus nested hollow components contribute only their own cavities, without double-counting another component's enclosure. Compute b1=b0+b2−chi; hasLoop is b1>0. Validate integer nonnegative Betti output. Separate sparse components use separate boxes; never flood the global enclosing box across distant components.

The ×3 refinement is the selected geometry convention, not visual subdivision of the block renderer. No external topology library or gameplay RNG is required. Source IDs remain opaque lookup handles. A registered query provider owns this numerical behavior; the scorer/passive/view cannot contain its own detector or branch on object identity.

## Deterministic experimental limits

Initial, reversible configuration: at most 256 original occupied cells, 6,912 refined voxels, 200,000 distinct closure elements, and 262,144 total padded-box voxel visits for cavity analysis. The refined-voxel bound is 27×256, and 27 closure candidates per such voxel bounds that stage by 186,624 candidates; the 200,000 element allowance covers that authoring cap. Validate representability of every ×3/×2/offset and padded volume product before iterating or allocating.

Limits apply to the entire query, not separately replenished for each component, row or nested call. Check a component box volume before enumerating it; charge its volume against the same remaining budget even if most cells are solid. Count failed/partial allocations and release temporary structures when returning unavailable. No timer, wall-clock deadline, browser speed or frame rate decides model eligibility. Limits are fixed run/experiment configuration, captured in exports/replay metadata; any authored override must be explicit and validated, not device-dependent auto-tuning.

These are provisional bench limits, not a proof of frame-time performance. The reproducible probe covers up to 500 cells; this design caps the initial experiment below that size. Re-running its assertions during design reproduced 17 fixtures and approximately 178 ms for the face method at 500 cells on this machine, versus about 8 ms for the closed convention. Those figures are single-machine evidence, not browser guarantees. Compute only on requested changed snapshots, never per frame or once per scored row. More efficient sparse cavity methods need separate evidence before replacing this algorithm.

## Unavailable policy and In the Loop

Oversize/safe-arithmetic/budget diagnostics remain distinct from hasLoop=false. In the Loop explicitly composes a registered neutral-exponent fallback (1, no contribution) when this query is unavailable, with a captured “topology not measured: limit exceeded” status visible in bench readouts/inspection/outcomes. Do not silently label the field as having no loop. This deterministic fallback avoids rejecting an otherwise legal move just because an experimental modifier cannot measure the layout. It does not become a universal default for unrelated gameplay queries.

On an available true result, In the Loop contributes exponent 1.2 once per installed instance per scored row, with existing additive-above-neutral exponent composition; false or explicit neutral fallback contributes exponent 1. It uses the scoring layout after pre-score effects, before row finalization. Post-score changes affect the next play, not finalized rows. Additional openings/length do not add contributions. Captured records, not delayed live queries, drive feedback. Keep the definition provisional; budget/performance/readability must be tested before any certification decision.

## Evidence, alternatives and verification

The research fixtures assert rings in all principal orientations, a 5×5 ring, straight/deep/bent tunnels and two openings as positives; slabs, solid cubes, open U, line, sparse cells, sealed shell and edge/corner-only loops as negatives under the selected face convention. The source probe's volume budget is expressed in original units then multiplied by 27 for face refinement; runtime configuration here is explicitly in REFINED voxel visits and must not multiply the stated 262,144 again.

Closed-cube contact is cheaper but contradicts the owner's face-only choice. Adjacency graph cycles give solid-slab false positives. Cavity counts alone miss loops; planar-only layers miss bent tunnels; camera projection is view-dependent. The selected method matches all existing fixtures and the authored geometry convention. The probe is evidence, not a formal proof for every adversarial input or a browser benchmark. Expand translation/axis-permutation, mixed cavity-plus-loop, negative-coordinate and budget-edge cases during implementation.

#885 implements the provider and immutable cache/limits; #886 implements the independent exponent passive. Verify no normal input/model mutation or RNG consumption, explicit unavailable/fallback diagnostics, no extra reward for count/depth, one query per snapshot/configuration, correct replacement/removal invalidation and phase-captured feedback. The planned scenario bench supplies deterministic positive/negative fixtures; normal catalogues remain unchanged.
