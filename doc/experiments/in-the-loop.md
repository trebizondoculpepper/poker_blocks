# In the Loop

Provisional passive experiment, owner decisions 2026-11-13 (#882). The exact name is **In the Loop**, not In a Loop. This brief records the agreed gameplay hypothesis; a production detector and certification are not established here. Related research #883, detector architecture #884, query #885 and passive #886 are separate gated slices. Broader unrelated spatial ideas remain parked in #616.

## Agreed objective and reward

At least one qualifying hoop or through-tunnel in the occupied playfield enables an exponent contribution of **1.2 on every scored row** while it exists. A simple flat ring surrounding empty space qualifies; deeper tunnels qualify too. The condition is boolean: second/additional openings and greater length/depth do not strengthen this passive. One installed instance contributes once per scored row. Duplicate passive instances, if explicitly admitted by an experiment, follow ordinary stacking rules; number of holes is not number of activations.

Use the existing exponent register/composition: neutral is 1 and increases above 1 combine additively. This contributes +0.2 to the combined exponent; it does not take an already-finalized powered result and independently raise it again. The owner rejected the suggested ×4 as too weak for constructing the feature. No price, unlock round, normal-shop weight or certification has been approved. Keep the definition provisional and expose it only through explicit experimental access.

Owner rationale: a visible opening is an approachable 3D construction objective, while enclosing a sealed cavity is harder to build and inspect under normal play/hand constraints. The conversational nine-block/play estimate was not an accepted geometric minimum. Multiple-card placements mean plays and block counts differ. No exact cavity minimum is asserted.

## Scoring interpretation to test

The owner described this as a post-scoring modifier on every scored row. Initial reversible interpretation: evaluate whole-field topology from the immutable layout being scored, then contribute through the row's ordinary exponent phase before line finalization/clamp. It is the final scoring effect category, not another score calculation after post-score material changes. Ordinary material and contributor eligibility stays unchanged; unrelated field cells can establish the global geometric condition without receiving individual card bonuses.

Post-score reactions that open/close a hoop affect the next play's eligibility, not already finalized lines. Pre-score changes are included in the scoring snapshot. Captured activation outcomes state eligibility, exponent contribution and actual affected row; presentation does not rescan a later live layout. The detector must be documented before this interpretation is implemented. This brief does not introduce a loophole for post-score material effects to rewrite scores.

## Detector requirements and unresolved semantics

The initial positive fixtures are a flat ring with empty space through it, in each principal orientation, and a deeper through-tunnel. Negative fixtures include a solid filled slab/cube, an open U-shape and a merely long or sparse arrangement. A square cycle in the face-adjacency graph of a solid filled 2×2 slab must NOT count as a hole: graph cycle count and empty-space topology differ. A sealed cavity alone is not the selected objective.

#883 must investigate exact foreground/background connectivity, corner/edge contact, open passages versus hoops, bent/branching tunnels, multiple openings and large sparse coordinate bounds. Compare cubical-complex/voxel topology with simpler restricted detectors and explain what each would miss. Do not silently narrow the owner’s deeper-tunnel semantics to a convenient planar-only algorithm or treat a camera-projected gap as authoritative. Conversely, this brief does not approve an unbounded general topology search.

Provide a pure registered boolean eligibility query over an explicit immutable field snapshot, with shared occupancy indexing, cache/invalidation rules and deterministic input/operation limits. No per-passive topology code or material/room identity branches. Define unavailable/oversize handling in #884 as part of the gameplay contract, never a machine-speed-dependent zero. Ordinary play without a subscriber must not pay for expensive topology. The detector architecture merges after inspectable research and before implementation.

## Bench protocol and evidence

Use the planned [passive scenario bench](passive-test-bench.md) to hydrate known positive/negative layouts and separately play normal construction attempts from matched initial decks. Record initial fixture versus actual placement actions, block/play counts, qualifying topology, baseline scores, resulting exponent composition and final scores. Compare with unconditional early ×4 and other available modifiers at representative score baselines; exponent 1.2 is not a constant multiplier. Test that additional holes leave the single-instance factor unchanged and that closing/reopening the feature changes subsequent eligibility correctly.

The [lifecycle geometry probe](../research/gameplay-lifecycle-opportunities.md#bounded-geometry-probe) distinguishes a shell's enclosed empty cell from a through-tunnel, but does not detect loops. [GUDHI cubical complexes](https://gudhi.inria.fr/python/latest/cubical_complex_user.html) and [scikit-image Euler/connectivity reference](https://scikit-image.org/docs/stable/auto_examples/segmentation/plot_euler_number.html) establish a mathematical vocabulary, not a selected JavaScript dependency or measured runtime cost. The research must supply bounded reproducible evidence before claiming a convincing game query.

No completed player trials exist in this brief. Judge whether the objective is readable, achievable and rewarding through the bench, then wider play; record assumptions/failures and keep certification separate. This follows [passive power progression](../passive-balance.md), where meaningful objectives deserve rewards beyond comparable unconditional boosts.
