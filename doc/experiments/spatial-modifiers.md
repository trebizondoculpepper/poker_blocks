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

## Provisional modifier implementation contract (#814)

This section makes the experiment deliverable without certifying its balance. All new definitions compose provisional release status; they are absent from normal acquisition and admitted only by explicit experimental catalogue access. See [release-status contract](../release-status.md), documentation issue #810. Trial names are working labels, not final artwork or shop prices.

### Scoring scope and frequency

Evaluate after opening/replacement and pre-score material actions have resolved, from the same immutable snapshot used for the current scoring pass. Packing observes the total occupied field, as the owner specified. That geometric context includes non-scoring cells, but does not grant those cards their ordinary individual bonuses. Dense/sparse each contribute one row multiplier to each actual scored row, once per installed modifier instance per row. They do not recursively rescore or add a second whole-play multiplier. Rows with no scored subset receive no contribution.

Mass defaults to the actual scored subset of the row. Select either total mass or mean mass through a configured registered aggregate query; the room can separately compare a field-wide scope as an explicitly labelled trial variant. Record scope with every outcome. A field-wide mass variant still contributes once per scored row, not once per field cell. Individual cards' ordinary bonuses retain their existing scored-subset rule. Diversity always observes the actual scored subset, never unrelated cards in that row or elsewhere.

These scope/frequency defaults are reversible designer decisions to enable experiments. They are not evidence that a high multiplier is balanced across repeated row scoring. Duplicate installed copies stack through existing score-modifier composition; the experiment should include single-copy controls before evaluating stacks. Activation feedback uses captured resolved values via existing descriptor/pulse traits and the shared visual scheduler. It never re-reads live rows or draws RNG during playback.

### Trial formulas

All factors are dimensionless. Expose parameters, query scope and handler configuration rather than a string mode that generic code branches over. Separate registered curve handlers supply each behavior. Clamp constrains a scalar to [0,1]. Reject nonfinite values, invalid denominators/reference masses, maximum below 1 and invalid thresholds at configuration validation.

| Modifier           | Initial trial factor                          | Initial parameters                 |
| ------------------ | --------------------------------------------- | ---------------------------------- |
| Dense              | 1 + (K−1) clamp((d−a)/(1−a))                  | K=10; a=0.70                       |
| Sparse             | 1 + (K−1) clamp((b−d)/b)                      | K=10; b=0.20                       |
| Heavy              | min(K, 1 + c ln(1 + m/m0))                    | K=10; c=3; m0=1 kg                 |
| Light              | 1 + (K−1)/(1 + m/m0)                          | K=10; m0=0.20 kg                   |
| Material diversity | greatest attained configured threshold factor | thresholds 2→×2, 3→×4; baseline ×1 |

Here m is the chosen total or mean physical mass. Heavy is logarithmic so increasing mass gives diminishing gains; logarithm input uses a mass ratio, not a dimensional quantity. Light is bounded, approaches ×1 for large mass, and has no inverse-mass singularity. Real nonempty blocks have positive mass; an unavailable/empty aggregate yields a neutral factor with an explicit diagnostic, not a fictitious mass of zero and ×10. Invalid installed physical profiles fail composition rather than silently yielding neutral rewards.

At d=.50 both density modifiers yield ×1; at d=.85 Dense yields ×5.5; at d=.10 Sparse yields ×5.5; full packing gives Dense ×10. A mean of 1 kg gives Heavy about ×3.079 and Light ×2.5. These examples check the chosen functions, not their balance. Changing maximum/coefficients is expected after actual trials.

### Material equivalence

A material-definition capability contributes a stable material-family token through a registered description/query provider. Derived cooking/temperature states inherit that family unless their definition explicitly documents a new family. Containers or shader variants alone do not automatically create a new scoring material; their definitions declare the family. The generic diversity query groups returned opaque tokens by equality; it does not branch on token names or maintain a material-name side table. Tokens may be displayed through their registered public names.

Provide an explicit family on every scored material admitted to the experiment. Migration preserves distinct base materials already defined by game rules; registry aliases/appearance-only prototypes may share the documented base family. Resetting/heating the same substance must not manufacture diversity by changing only a display state. Missing family is a composition validation error. Count distinct families after pre-score transformations, using captured contributing-card IDs. Two materials and three-or-more thresholds are not cumulative: three materials earns ×4, not ×2×4. Four-or-more stays ×4 until a new curve is explicitly configured.

### Query and capability owners

Registered packing query owns bounds/count/capacity and d; registered physical-mass contributions own density × authored volume or composite effective mass; aggregate queries own total/mean for an explicit snapshot scope; registered material-family query owns grouping facts. Scoring modifier traits request these facts and contribute factors through the existing line-finalization registry. Generic scorers/run controllers do not name these modifiers, test release flags or scan material names.

[Physical mass and rocking](../playfield-rocking.md), documentation issue #782, defines the shared nominal volume, real-density references and labelled mixture/fantasy assumptions. #816 implements the shared mass capability/aggregates; #783 consumes it for rocking, while #824 consumes it for weighted-center queries. A card's mass does not change with camera scale or cosmetic shader density. The parked contents-plus-wrapping Present idea #828 does not change today's opaque wrapper policy.

### Room controls and exports

#820 composes reusable Dev traits for random deck construction, live queries/readouts, modifier selection and parameter editing. Its default trial is ordinary ranked-card play under a sandbox rule configuration, with no ordinary acquisition of provisional definitions. Builder configuration owns the generation distribution; preserve standard card templates initially and make material weights editable through admitted definition references. Reuse [deck builders](../deck-builders.md), #826/#827, rather than a second deck factory. Record the configured passive instances and distinguish an installed scoring trial from a neutral baseline/counterfactual overlay.

Show packing density, occupied count, box capacity, total/mean mass, selected scope, actual scored contributors/families, raw row result and each applied factor. Visual updates consume committed results. Parameter edits between actions begin a new trial segment; never retroactively change committed scores or mutate an already playing visual payload. Controls may apply to subsequent plays only. Bench objects show their release status through the shared facet.

#821 provides local versioned JSON exports: configuration-only for authoring, and complete trial evidence for replay/comparison. Include schema/source revision, builder algorithm/configuration version, seed and initial logical card descriptors, configured definitions/parameters/scoring rules, committed action order and parameter changes, per-action query/results, actual contributed factors and final outcomes. Preserve hidden payload descriptors only in an explicitly internal reproducibility artifact, never ordinary inspection or public hover labels; warn that a full replay artifact can disclose future draws. Do not include credentials or runtime listeners/functions. Define nonsecret logical descriptors and fresh runtime-ID mapping on import. Unsupported versions reject explicitly without mutating an active run.

Configuration import validates before replacing a trial. Full replay validation uses the same registered commands and deterministic model RNG; no presentation effects are replayed as gameplay and no old run is partially overwritten on failure. Captured exact starting state/actions are authoritative reproduction evidence when a seed alone is insufficient. If existing persistence codecs cannot represent a needed field, report that concrete gap before designing a competing save format. Export is local; remote telemetry and a second authoritative live card inventory are outside scope.

### Evidence, verification and limits

`src/passives.ts` already declares configured score.beforeLineFinalized event rules; `src/scoring.ts` determines scored subsets. `src/materials.ts` defines material scoring and derived appearances; it does not yet provide a uniform diversity family or physical-mass capability. `doc/game-events.md` and `doc/research/gameplay-lifecycle-opportunities.md` support snapshot-scoped derived queries, while `doc/ordered-card-ownership.md` separates live zones from reconstruction history. These seams support registered queries and row modifiers; they do not prove their runtime migration is complete.

Verify formula samples and boundaries, normalized units, count versus mean distinction, full-line packing, outlier sparse cases, pre-score material replacement, excluded non-scoring extras for diversity, inherited family equivalence, one contribution per scored row, independent stacked copies, reproducible commands/RNG, and descriptors matching actual factors. Compare matched starts at similar block counts/play budgets; report ability to exploit sparse outliers and filled-line Dense ×10 rather than quietly changing the definition. No player-playtest evidence, thresholds, prices or production certification is established by this document.

## Scenario bench integration (#867)

[The passive scenario contract](passive-test-bench.md) supplies Dev controller/setup traits and reusable per-instance parameter configuration for #820. Apply restarts the same initial scenario/seed with new settings; fixture hydration is distinct from executing replay commands. Use its codecs, schema controls and setup/export ownership rather than registering a new definition for every parameter set.
