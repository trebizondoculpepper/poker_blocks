# Passive blocks: first playable set

The first playable `dev2` passive set uses the rules below. A fresh run deals two distinct passives; saved runs keep their rack and coins. Passive tokens are rendered from their appearance definition: most are cubes, while dice use polyhedra with separate artwork on each face. Their palettes and icons are first-pass designs, and point values can be tuned after playtesting.

## Composition contract

Every passive is a **block instance** with a stable instance id and a definition id. Its definition is plain data: a display name and a list of trait configurations. It contains no callback function or block-specific behavior code. The instance lives in the ordered `GameState.passiveRack`, is saved by id and definition, and has no card identity unless a separate trait grants one.

The first set uses these reusable trait types:

| Trait          | Configured data                                                     | Shared behavior                                                                                                                                            |
| -------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RackResident` | Zone and any future capacity or sale settings                       | Keeps the block in the passive rack and makes it eligible for events.                                                                                      |
| `Inspectable`  | Name and description                                                | Returns the text shown on hover or touch inspection.                                                                                                       |
| `Appearance`   | Shape, per-face artwork, palette, border and surface pattern         | Draws a passive token. Its styling has no scoring effect and is independent from card material.                                                            |
| `EventRule`    | Event id, target selector, condition, ordered effects and use limit | Subscribes only to named events in its config. Evaluates reusable conditions and returns typed effect descriptions. One block may configure several rules. |

`EventRule` uses named, reusable condition handlers (such as `material-is`, `suit-in`, `rank-count-at-least`, `line-length`, and `perpendicular-intersection`) and effect handlers (such as `add-block-value`, `multiply-block-value`, `add-line-score`, `multiply-line-score`, `add-coins`, and `grant-random-unowned-passive`). The handlers are trait/runtime code. Registry entries supply values and selectors, not new functions. New conditions and effects can extend this vocabulary without changing the block container.

The first migration slice introduces serializable `EventRule({ on, select, where, effects[] })` data and an `EventRuleRegistry` that dispatches registered selectors, conditions, and ordered effects. The queue can subscribe from this new data. Live passives still use the legacy `PassiveRule` shape and calculation path until the scoring and action migrations land; this slice does not change their results. Each handler registration is typed against its own configuration. Unknown handler IDs fail during evaluation. The runner does not inspect those IDs to choose behavior.

For example, Seeing Red is data shaped like `EventRule({ on: "discard.completed", select: "discarded-blocks", where: { suitIn: ["hearts", "diamonds"] }, effects: [{ addCoinsPerMatch: 1 }] })` alongside its rack, inspection, and appearance trait configurations. The same rule trait and `suitIn` predicate can serve another block with different suits or a different amount.

At stage start, register the installed blocks' subscriptions; update registrations when a block is installed, sold, or destroyed. For one event, take a snapshot of rack order and resolve subscribed blocks **left to right**. Resolve a block's configured rules and effects in their listed order. Apply an effect before moving to the next passive, so later passives see the updated working value. Events caused by effects go to the back of the FIFO queue; a newly installed passive does not retroactively respond to the event that installed it. Keep the queue's loop limit and error reporting.

Only the relevant phase may change a working value. `score.beforeBlockValue` can adjust one contributing block's value; `score.beforeLineFinalized` can adjust the line's working score; `discard.completed` can award coins or install a passive. Clamp a line's final score to zero after all its line effects have resolved, so a penalty never subtracts points from the stage total. One-block runs remain unscored. The line length used by conditions is the number of blocks in the **maximal, gap-free line**, even when a long line scores using a five-block subset.

## Categories

The categories follow the Balatro community wiki's seven Joker effect types (Chips, Additive Mult, Multiplicative Mult, Chips + Additive Mult, Effect, Retrigger, Economy). We fold the four scoring types into one **Scoring** category and show the scoring operation with an accent tint instead.

Each category is a **trait** (`scoringCategory`, `economyCategory`, `effectCategory`, `retriggerCategory`), and together they form the **category facet** in `src/passive-categories.ts`. Every passive composes **exactly one** trait from the facet, naming its primary purpose (issue #81); `src/passive-categories.test.ts` enforces this for every definition. A category trait brings presentation defaults and nothing else: colours, an appearance finish, and an activation visual and sound. No rule, condition or effect reads it, and the same test checks that gameplay code never names a category trait or the scoring tints. The finish is appearance only and is unrelated to a card's gameplay material.

| Category trait      | Base colour | Finish         | Activation visual       | Activation sound             | Passives                                             |
| ------------------- | ----------- | -------------- | ----------------------- | ---------------------------- | ---------------------------------------------------- |
| `scoringCategory`   | White       | Porcelain      | Brief white score pulse | `passive.activate.scoring`   | ×2, ×4, Carnivore, Woodworker, Crossroads, Long Haul, D6, D8, D10, D20 |
| `economyCategory`   | Green       | Brass          | Green coin glint        | `passive.activate.economy`   | Gold Standard, Scrapper, Seeing Red                  |
| `effectCategory`    | Black       | Matte obsidian | Brief dark ripple       | `passive.activate.effect`    | Ace Exchange                                         |
| `retriggerCategory` | Orange      | Copper         | Quick orange echo ring  | `passive.activate.retrigger` | None yet                                             |

Card manipulation is part of Effect until a passive needs its own category.

**Scoring tint.** A scoring passive stays white porcelain; its edge and symbol take an accent from `scoringCategory { operations }`: **icy blue** for additive, **indigo** for multiplicative, **violet** for exponential. A passive with several operations blends their tints evenly. ×2, ×4 and Carnivore are multiplicative; Woodworker, Crossroads, Long Haul and the dice are additive. The tints are in `scoringTints`, in the same file.

Passives show their category's look by default. A definition may set its own `palette` only where an explicit design calls for it; none does today.

**Not yet wired:** the activation visuals and sounds are configured and their sound ids registered, but nothing plays them yet. Playing them needs passive activations reported by the event-rule work in #63.

Passive appearance is independent of card identity and gameplay material. A `PassiveDefinition` may declare a shape (`cube`, `octahedron`, `d10`, or `icosahedron`) and per-face artwork; rack and shop previews both use the shared `createPassiveVisual` factory. The field remains a cubic card grid. Stable DOM slots handle pointer interaction, so small triangular or kite-shaped faces do not become hit targets.

Dice passives are scoring-category passives. Each installed die rolls once at the beginning of a scoring resolution, and its single result is added to every scored line in that resolution. Multiple dice roll independently. A die is not rerolled for each row or during candidate-hand evaluation.

| Passive | Bonus per scoring resolution | First shop round | Token shape |
|---|---:|---:|---|
| D6 | +1 to +6 on every scored line | 1 | Cube with six standard pip faces; opposite pairs total 7 |
| D8 | +1 to +8 on every scored line | 2 | Octahedron, numbered 1–8 |
| D10 | +1 to +10 on every scored line | 3 | Pentagonal trapezohedron, numbered 1–10 |
| D20 | +1 to +20 on every scored line | 4 | Icosahedron, numbered 1–20 |

Later dice are filtered out of shop stock until their listed round and are excluded from opening passives.


## Definitions

Every row below also carries rack residency, an inspectable name and effect description, and appearance data. The listed `EventRule` data is the meaningful behavior configuration. The values are for the first playtest.

| Block (id)                                      | `EventRule` configuration                                                                                                                                                                                                                                 | Visual design                                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **×2** (`double-line`)                          | On `score.beforeLineFinalized`, target the current line; multiply its working score by **2**.                                                                                                                                                             | Midnight blue cube with a large silver ×2 and a thin double border.                               |
| **×4** (`quad-line`)                            | The same `EventRule` and effect as ×2, configured with factor **4**.                                                                                                                                                                                      | Deep amethyst cube with a gold ×4 and four small corner marks.                                    |
| **Carnivore** (`carnivore`)                     | On `score.beforeBlockValue`, if the contributor's gameplay material is **meat**, multiply that block's working value by **2**. Repeat for each eligible contributor and each line scored.                                                                 | Dark oxblood cube with restrained marbling and a pale tooth mark; red lettering remains readable. |
| **Woodworker** (`woodworker`)                   | On `score.beforeBlockValue`, if the contributor's gameplay material is **wood**, add **3** to that block's working value.                                                                                                                                 | Honey-colored wood-look cube with a branded chisel mark and visible end grain.                    |
| **Crossroads** (`crossroads`)                   | On `score.beforeLineFinalized`, count blocks in the current line that also belong to a perpendicular gap-free line of at least two blocks; add **3 per such block**. Count each intersecting block once for this line even if it crosses both other axes. | Slate cube with three fine white axes meeting at a bright central dot.                            |
| **Long Haul** (`long-haul`)                     | On `score.beforeLineFinalized`, add **−5** when the line has exactly two blocks; add **+5** when it has three or more.                                                                                                                                    | Split charcoal and cream cube: a short dotted stroke below and a longer rising stroke above.      |
| **D6** (`dice-d6`)                              | Roll once per scoring resolution; add the same random value from **1–6** to every scored line. Available from round 1.                                                                                                                                   | White cube with six distinct standard pip layouts; opposite faces sum to 7.                       |
| **D8** (`dice-d8`)                              | Roll once per scoring resolution; add the same random value from **1–8** to every scored line. Available from round 2.                                                                                                                                   | White octahedron with numbered triangular faces.                                                  |
| **D10** (`dice-d10`)                            | Roll once per scoring resolution; add the same random value from **1–10** to every scored line. Available from round 3.                                                                                                                                 | White pentagonal trapezohedron with ten numbered kite faces.                                      |
| **D20** (`dice-d20`)                            | Roll once per scoring resolution; add the same random value from **1–20** to every scored line. Available from round 4.                                                                                                                                 | White icosahedron with numbered triangular faces; opposite faces sum to 21.                       |
| **Scrapper** (`scrapper`)                       | On `discard.completed`, count all blocks discarded by that one action; add **1 coin per block**.                                                                                                                                                          | Worn steel cube with a stamped scrap mark and a small gold coin inset.                            |
| **Seeing Red** (`seeing-red`)                   | On `discard.completed`, count discarded blocks whose suit is Hearts or Diamonds; add **1 coin per matching block**. This stacks with Scrapper.                                                                                                            | Cream cube with paired red ♥ and ♦ marks, red edge stitching.                                     |
| **Ace Exchange** (`ace-exchange`, working name) | On `discard.completed`, if the action contains **at least two Aces**, grant **one** random passive definition the player does not already own. Trigger once for the action, including a three- or four-Ace discard.                                       | Violet cube with two overlapping A marks and a small empty-slot sparkle.                          |

The appearance trait describes a passive's **look**. A wood-look Woodworker block in the rack is not itself a scoring wood card; Carnivore and Woodworker inspect the gameplay material of card blocks contributing to a line.

For Crossroads, inspect the completed field's geometry before line scores are presented. A crossing line need only exist; its own points do not enter the condition. This prevents a scoring dependency cycle. If several lines cross the same block, each scored line receives its own bonus when it resolves.

For Ace Exchange, “owned” includes installed passives and any future passive collection, not just the rack. In the current `dev2` model, the rack is the only ownership zone. Choose uniformly from eligible registry definitions using the session's injected random source; if none remain, do nothing. `dev2` has no rack cap for this experiment. Installing the new block updates subscriptions, saves the new instance, and queues `passive.installed` after all listeners of the current discard have finished. The grant does not spend another discard or play.

## Stage-won rewards

A rule with `on: "stage.won"` pays coins when a stage is won, judged on the blocks still in the hand, and appears as its own row in the stage-won ledger (rack order). **Gold Standard** (`gold-standard`) is the first: `{ on: "stage.won", condition: { kind: "material", value: "gold" }, effect: { kind: "add-coins", amount: 1, perMatch: true } }`, one coin per gold block left in the hand. A `{ kind: "stage", kinds: ["boss"] }` condition instead tests the won stage itself, so a rule can pay for boss wins only (one flat amount, not per hand block).

## Dev mode and verification

On a **fresh** `dev2` run, choose two different definitions from this roster and install one instance of each, in chosen rack order. Reloading a saved run preserves its rack and coin balance rather than drawing again. Give card blocks randomized gameplay materials so Carnivore and Woodworker can actually be tried. A new-game action redraws the pair.

Verify at least: order-sensitive combinations with ×2 and Long Haul; a meat or wood block contributing to two lines; Crossroads on X/Y/Z intersections; a multi-block discard with both Scrapper and Seeing Red; two Aces in one discard creating exactly one unowned passive; exhaustion of eligible passives; and save/reload preserving the awarded coins and newly installed block. Score presentation must use the same final line results as the stage total.

For lines longer than five, compare five-block candidate hands using the same configured score calculation, but make candidate evaluation side-effect free. Only the chosen result may emit coin, install, or presentation effects. The precise tie-break rule remains the one in [game.md](game.md).
