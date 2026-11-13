# Experiments

This area records reproducible gameplay and presentation experiments. Experiments inform decisions; their hypotheses, provisional configurations and observations are not production rules. Canonical rules remain in [game.md](../game.md), and reusable implementation contracts in [game-architecture.md](../game-architecture.md). Implementation follows separately merged architecture.

## Catalogue

- [Spatial modifiers: packing, mass and topology](spatial-modifiers.md): planned interactive playtest; initial geometry probe exists, but no player-session results yet.

- [Centroid versus material-weighted pivot](pivot-comparison.md): planned A/B room with a paper-heavy seeded deck; production pivot unchanged.

- [In the Loop](in-the-loop.md): agreed provisional hoop/tunnel objective and exponent reward; detector research/architecture still required.

## Recording an experiment

Each brief states its question, agreed semantics, provisional assumptions, evidence, reproducible setup, measurements, limitations and next decision. Record configuration/schema version, source revision, random seed, initial state and ordered actions with results. A seed alone cannot reproduce player choices. Keep observations separate from interpretations, include failed trials, and report unsupported measurements explicitly rather than as zero.

Results belong beside the brief or in linked versioned artifacts, with hardware/browser details for performance claims. Research reports under [research](../research/) remain valid evidence; link them rather than relocate or duplicate them. Promote a conclusion into canonical design in its own reviewed documentation PR before production implementation.

## Balance rationale

[Passive power progression](../passive-balance.md) explains why the bench exists: try abstract reproducible situations, observe how provisional rules feel and behave, then use evidence to inform wider testing and later balance/certification decisions.
