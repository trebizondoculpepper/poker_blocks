# Composable starting-deck builders

Target contract for #826/#827. A mode composes a deck-builder definition; run setup invokes that definition through the existing registered setup mechanism. This supports experimental and future unlockable starting decks without setup knowing a mode's identity. It does not implement unlock progression, change a normal starting deck, or replace [ordered deck ownership](ordered-card-ownership.md).

## Ownership and composition

A deck-builder definition owns an ordered list of configured registered operations. The shared builder runner dispatches by operation name, never by mode, material, card kind or builder identity. Builder IDs are opaque lookup handles. A registered setup adapter invokes the selected builder, passing explicit admitted definition candidates, seed/RNG, fresh-ID factory and validated configuration. The mode owns the builder selection/configuration; operations own generation behavior; the resulting run owns its actual cards.

Initial operations cover a configured card-template pool (rank/suit combinations and copies), material assignment, adding configured special cards and shuffling. Operations may be reused and extended through handlers; there is no switch over known builder types. Template entries are definition references resolved through their registered factories, not identity-keyed special behavior. Rankless special cards use the documented active-object factories rather than fabricated poker identities. Hidden contents are created once through their existing creation contract, not rerolled on inspection or shuffle.

The builder context carries a temporary ordered list of newly created instances, validated definition/configuration and a scoped RNG. Each operation returns the next context. Operations do not move existing live run cards, mutate a global standardDeck, install listeners or emit presentation effects. On failure publish no partial deck or ownership change. Unknown operations, invalid references, duplicate generated instance IDs, negative/nonfinite weights/counts, or empty candidate sets where cards are required reject with an inspectable configuration error.

The builder creates fresh instance identities even if templates have the same rank/suit. Mutable card state and nested payloads are independent. A shuffle permutes the completed list without cloning or replacing instances. The standard normal mode initially uses the same standard 52 rank/suit cards and the documented normal material; no starting-card duplication or distribution change is implied by this refactor.

## Material distributions and the first experiment

Weighted assignment accepts an ordered list of definition references and nonnegative weights. Normalize by the sum and independently sample once per card from the builder RNG. Do not require percentages to total 100, but reject a zero/nonfinite sum. Weights express probabilities, not guaranteed exact proportions in a finite deck. Export the effective normalized distribution and the generated initial list.

For the pivot experiment #823/#825, suggested initial weights are Paper 70, Wood 15, Gold 5, Steel 5, Prismatic Crystal 5. These references belong to the mode's configuration in src/game-modes.ts, not a side table in generic code. Their release-status access follows the requested catalogue contract; a future provisional definition cannot accidentally appear in normal generation.

A distinct balanced-assignment operation preserves the current materialDeck semantics: distribute candidate definitions cyclically across templates, then shuffle assignments using the seed. Uniform assignment is configured through its own registered operation or a degenerate single-candidate distribution where results/RNG semantics are explicitly preserved. Do not silently replace balanced assignment with weighted independent draws during migration: they yield different distributions and RNG consumption.

Operation order is observable and exported. Adding a card before shuffle differs from adding it after shuffle. A configured exact composition (for example exactly 36 Paper cards) needs an explicit count/template operation; do not promise exact counts from weights. No generic builder infers a special mode's deck from the name of the mode.

## Determinism and restoration

A new run creates one generation seed through the existing injected seed service. A builder-local seeded stream owns every random assignment and permutation; generation must not consume presentation RNG or depend on unrelated shop/animation activity. Record a builder schema/version, ordered effective configuration, seed, and the initial generated descriptor list needed for reproduction. Fresh runtime IDs may be allocated separately, with a reproducible logical descriptor/order for experiments. Duplicate content is legal; duplicate instance IDs are not.

Save/load restores current authoritative ordered zones and each card's state. It does not run the starting builder again to replace cards that were transformed, removed, bought or opened. Existing version-1 records currently reconstruct original cards from a saved seed/starting definition before applying ledgers; preserve the existing decoder path and its exact historical generator semantics. New builder configurations must be retained with the run or use a validated versioned descriptor so a later mode edit cannot reinterpret a save. #827 must cite existing persistence codecs and compatibility fixtures; if it cannot preserve old records with additive validated metadata, report the concrete gap before changing the save schema. No mandatory wholesale save rewrite is authorized here.

Resetting an existing run's stage/round does not call the starting builder. A new run/restart explicitly requests a fresh construction through the mode lifecycle. Builders are pure generation operations, so no scene attach/dispose subscriptions are needed; the setup adapter owns cancellation/error delivery before committing a new run. They produce no sounds directly. Existing new-run actions and their controller traits own user-facing feedback.

## Evidence and alternatives

`src/run-setup.ts` already declares ordered registered setup passes and a deck handler; `RunSetupRegistry.pass` dispatches handlers rather than branching on mode identity. `src/run-setup-behaviours.ts` registers materialDeck and uniformMaterialDeck, currently delegating to separate factories. `src/materials.ts:makeDevDeck` cycles material candidates then shuffles assignments with seededRandom; it is not independent weighted sampling. `makeUniformDeck` applies one configured material to standardDeck. These establish the adapter seam and the compatibility distinction.

A weighted-only new setup step would satisfy one room but keep deck construction split among factories; a declarative builder is chosen because the owner wants reusable combinations for later starting-deck modes. Replacing the setup registry entirely would duplicate an existing mechanism and is unnecessary. The builder sits behind it. Source audit plus the existing ordered-card/save contracts supports this design; no external library is needed. This is a target API contract, not a claim that builder or persistent ordered-deck migration has already shipped.

## Verification and delivery

#827 implements the builder and setup adapter in a later PR, preserving the normal deck and old generator semantics. Verify deterministic generation, independent weighted frequencies through a bounded fixed-seed sample, exact uniform/balanced migration fixtures, operation order, fresh/nested identity isolation, empty/invalid inputs, shuffle preserving instances, restoration preserving mutations and saved order, and no mode-identity decisions. #825 configures the pivot room only after this capability and its own pivot contract merge. Future deck variants can reuse the pattern without a new architecture mission when its ownership/lifecycle already fits.
