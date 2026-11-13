# Spatial-modifier experiment

Status: planned playtest, not implemented. Related: #806, broader research #616 and lifecycle research #615. No player-session measurements or balanced production rewards are claimed.

## Questions and agreed meaning

Can players deliberately achieve dense or sparse arrangements while building useful poker hands? What packing densities arise during ordinary play, and which reward curves create worthwhile compromises?

Packing density is occupied field cells divided by the capacity of the smallest world-grid-axis-aligned box enclosing them. Inclusive side lengths are max − min + 1. A filled line and a filled cube both have density 1; there is no extra preference for cube-like shapes. Use authoritative occupied cells, not camera projection or animated meshes. Empty-field density is unavailable and awards no experimental bonus; a single block has density 1. These boundary policies are provisional defaults for the bench.

The user wants separate passives rewarding high and low packing density. Material mass is a separate measurement and must not silently change packing density. Reward strength and thresholds remain provisional: earlier symmetric linear curves were rejected as too weak or too generous to ordinary arrangements. In particular, 50% occupied is not a useful definition of sparse play for this game.

## Initial configurable hypotheses

Start with these explicitly unbalanced trial curves, where d is packing density and clamp limits to [0, 1]:

- Dense multiplier: 1 + (maximum − 1) × clamp((d − denseStart)/(1 − denseStart)).
- Sparse multiplier: 1 + (maximum − 1) × clamp((sparseStart − d)/sparseStart).
- Initial maximum 10, denseStart 0.70, sparseStart 0.20. These are designer suggestions to test, not user-approved balance. Validate 0 < sparseStart < denseStart < 1 and maximum ≥ 1.

Measure each passive alone first, then both together. Record the precise scoring scope and activation frequency in every trial; these remain design choices, not inferred implementation permission. Show counterfactual modifiers alongside the ordinary model score until the scoring integration contract is agreed. Do not count a displayed hypothetical result as actual awarded points.

## Interactive bench and reproducibility

A future dev mode should allow normal placement with random blocks, adjustable curve parameters and a live overlay of occupied count, box extents/capacity, density, base score and clearly labelled hypothetical modifiers. Keep random generation separate from production balance tables and export the actual configured distribution. Include a normal-play baseline and directed dense/sparse attempts using matched seeds and starting configurations. Compare at similar block counts and play budgets; log outcomes rather than just the final attractive screenshot.

Copy Configuration exports a versioned configuration, seed and source revision. A separate replay/result export includes initial state, ordered committed actions, parameter changes, per-play measurements and final outcome. Parameter changes start a new trial or are explicitly logged. Export enough state to reproduce generation despite unrelated RNG consumption. Record stage/dealer and scoring configuration; never export secrets. No experimental telemetry service is required.

The room and its measurement/export capabilities must be composed from Dev-prefixed traits. Registered pure queries read immutable model snapshots and cache by snapshot/configuration. Controllers connect lifecycle hooks to measurements; generic code must not branch on room, material or passive identity. Presentation uses captured results and the shared scheduler for finite feedback, without delaying scoring or input. This brief does not authorize missing runtime patterns; implementation tickets must cite the merged lifecycle/query, scoring and dev-tool contracts.

## Measurements to explore

| Family    | Candidate measurement                               | Interpretation and limit                                                                                                                                                                                 |
| --------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Packing   | occupied count / enclosing capacity                 | Filled lines are fully packed; distant cells can sharply lower density.                                                                                                                                  |
| Material  | total mass; mass / enclosing physical volume        | Requires authored physical mass/volume capabilities; current equal-mass camera assumptions are not evidence of material masses. Hollow assemblies need shell/content accounting without double counting. |
| Surface   | exposed face count; exposed faces per occupied cell | Six face-neighbor queries per block with a shared cell index; compare equal counts.                                                                                                                      |
| Structure | connected components, local degree, branching       | Face adjacency is the initial probe convention, not a final topology decision.                                                                                                                           |
| Shape     | height, axis extents, elongation, defined symmetry  | Axis-aligned and rotation-invariant notions differ; scope must be explicit.                                                                                                                              |
| Topology  | independent loops/tunnels and enclosed cavities     | A hoop is not a sealed cavity. Graph cycles alone do not measure solid-object tunnels.                                                                                                                   |

Mass values for real substances may be evidence-calibrated, but mixtures, hollow assemblies and fictional materials require labelled authoring assumptions. No production mass table is established by this experiment.

## Existing evidence and limits

The [lifecycle research](../research/gameplay-lifecycle-opportunities.md#bounded-geometry-probe), [probe](../research/lifecycle-geometry-probe.mjs) and [results](../research/lifecycle-geometry-results.json) compare a filled cube, line, ring, hollow shell and through-tunnel. Rerun with `node doc/research/lifecycle-geometry-probe.mjs`. They establish example semantics, not browser performance or how players normally build. A sealed shell has an enclosed empty cell; the tunnel and flat ring do not.

[Scikit-image's Euler-number reference](https://scikit-image.org/docs/stable/auto_examples/segmentation/plot_euler_number.html) distinguishes components, tunnels and cavities and explains foreground/background connectivity conventions. [GUDHI's cubical-complex documentation](https://gudhi.inria.fr/python/latest/cubical_complex_user.html) supplies an established grid-topology model. These support investigating voxel topology; neither is a selected JavaScript runtime dependency. Face, edge and corner connectivity must be settled consistently before topology rewards are specified.

Bounds, mass sums and exposed-face scans can be linear in occupied cells with suitable shared indexing. Exterior empty-space flood fill instead depends on searched volume: sparse distant blocks can make it enormous. The existing probe caps search at 10,000 cells. Production topology needs a documented deterministic budget or sparse/compressed strategy, and an explicit unavailable result; never silently award zero because one machine was slower.

## Decision after trials

Review density distributions by block count, achieved poker scores, ease of manipulating the box with outliers, and the marginal benefit of each curve. Compare baseline, dense and sparse strategies before choosing prices, activation scope, thresholds, caps or payouts. Topology and material-weight passives remain further proposals. Split subsequent work into shared query capabilities, passive scoring integration and the experimental room/export implementation, each behind its merged documented contract.
