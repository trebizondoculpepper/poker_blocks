# Passive blocks: first playable set

The first playable `dev2` passive set uses the rules below. A fresh run deals two distinct passives; saved runs keep their rack and coins. The rack displays real, slowly rotating 3D cubes with each block's icon on all six faces. Their palettes and icons are first-pass designs, and point values can be tuned after playtesting.

## Composition contract

Every passive is a **block instance** with a stable instance id and a definition id. Its definition is plain data: a display name and a list of trait configurations. It contains no callback function or block-specific behavior code. The instance lives in the ordered `GameState.passiveRack`, is saved by id and definition, and has no card identity unless a separate trait grants one.

The first set uses these reusable trait types:

| Trait          | Configured data                                                     | Shared behavior                                                                                                                                            |
| -------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RackResident` | Zone and any future capacity or sale settings                       | Keeps the block in the passive rack and makes it eligible for events.                                                                                      |
| `Inspectable`  | Name and description                                                | Returns the text shown on hover or touch inspection.                                                                                                       |
| `Appearance`   | Face symbol, palette, border and surface pattern                    | Draws the same identity on all visible faces. Its styling has no scoring effect.                                                                           |
| `EventRule`    | Event id, target selector, condition, ordered effects and use limit | Subscribes only to named events in its config. Evaluates reusable conditions and returns typed effect descriptions. One block may configure several rules. |

`EventRule` uses named, reusable condition handlers (such as `material-is`, `suit-in`, `rank-count-at-least`, `line-length`, and `perpendicular-intersection`) and effect handlers (such as `add-block-value`, `multiply-block-value`, `add-line-score`, `multiply-line-score`, `add-coins`, and `grant-random-unowned-passive`). The handlers are trait/runtime code. Registry entries supply values and selectors, not new functions. New conditions and effects can extend this vocabulary without changing the block container.

The first migration slice introduces serializable `EventRule({ on, select, where, effects[] })` data and an `EventRuleRegistry` that dispatches registered selectors, conditions, and ordered effects. The queue can subscribe from this new data. Every passive uses it now: scoring since slice 2 (#139) and discard and stage-won since slice 3 (#170). See "Scoring path" and "Discard and stage-won path" below. The legacy `PassiveRule` shape is gone. Each handler registration is typed against its own configuration. Unknown handler IDs fail during evaluation. The runner does not inspect those IDs to choose behavior.

For example, Seeing Red is data shaped like `EventRule({ on: "discard.completed", select: "discarded-blocks", where: { suitIn: ["hearts", "diamonds"] }, effects: [{ addCoinsPerMatch: 1 }] })` alongside its rack, inspection, and appearance trait configurations. The same rule trait and `suitIn` predicate can serve another block with different suits or a different amount.

At stage start, register the installed blocks' subscriptions; update registrations when a block is installed, sold, or destroyed. For one event, take a snapshot of rack order and resolve subscribed blocks **left to right**. Resolve a block's configured rules and effects in their listed order. Apply an effect before moving to the next passive, so later passives see the updated working value. Events caused by effects go to the back of the FIFO queue; a newly installed passive does not retroactively respond to the event that installed it. Keep the queue's loop limit and error reporting.

Only the relevant phase may change a working value. `score.beforeBlockValue` can adjust one contributing block's value; `score.beforeLineFinalized` can adjust the line's working score; `discard.completed` can award coins or install a passive. Clamp a line's final score to zero after all its line effects have resolved, so a penalty never subtracts points from the stage total. One-block runs remain unscored. The line length used by conditions is the number of blocks in the **maximal, gap-free line**, even when a long line scores using a five-block subset.

### Scoring path (#139)

Scoring passives are `EventRule` data on their definitions (`eventRules`). Every handler they name is registered in `src/rule-handlers.ts`:

| Kind          | Handlers                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------ |
| Selectors     | `scored-block` (the block being valued), `scored-line` (the line, with its crossing count) |
| Condition     | `always`, `material-is`, `line-length`, `perpendicular-intersection`                       |
| Effects       | `multiply-block-value`, `add-block-value`, `multiply-line-score`, `add-line-score`         |
| Value sources | `fixed { value }`, `roll { sides }` (#97): any effect amount may be one                    |

`scoreFieldWithPassives` (`src/passive-effects.ts`) takes the rack's rules subscribed to each scoring event, in rack order and then listed order, and runs them over a working value. It never asks which rule or passive it is running.

1. **`score.beforeBlockValue`:** for each block in a line, the event carries the line, its crossing count and the block. The rules turn the block's base value into its working value.
2. **Candidate hands:** a line of six or more tries every five-block subset using those working values. A block's value is the same in every candidate, so each block is evaluated once.
3. **`score.beforeLineFinalized`:** the chosen hand's points become the line's working value, and the line rules apply. The result is clamped at zero.
4. **Evaluate, then commit:** evaluation is pure. Only the chosen hand's contributing blocks, and then the line's rules, are committed as the line's `activations` (which passive fired, on which event and block, and the commands its effects collected). Presentation can show them (#81).

**Cards bring rules too (#141).** A card's material expands its `scoringModifier` into the card's own rules (`cardScoringRules`, `src/materials.ts`). For each block value, the card's own rules run first, then the rack's. After the hand is chosen, the line runs three phases in order: `score.lineMultiply`, then `score.linePower`, then `score.beforeLineFinalized`. Each phase runs the **contributing** cards' rules first, then the rack's. The score is rounded once, after every effect, and clamped at zero. Activations name their source: a passive's instance id, or the card's id for a material rule.

A new scoring behaviour is one handler registration. No scoring code changes; `src/scoring-rules.test.ts` registers a test-only effect to prove it.

**Value sources (#97):** an effect's configured amount may be a value source instead of a number. Value sources are registered alongside the handlers: `fixed { value }` and `roll { sides }`. At the start of each scoring resolution, `scoreFieldWithPassives` resolves every passive's rules once (`ruleHandlers.resolveValues`) with the run's random source. Each value source draws once, and the effects see plain numbers. A rule with no value source draws nothing, so the run's random sequence is unchanged for racks without dice. Callers that don't pass a random source get an error only if a rule actually draws one.

### Discard and stage-won path (#170)

Discard and stage-won rules run through the same registry. Their effects never change the game. They **collect commands**, and the game run commits them.

| Kind       | Handlers                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| Selectors  | `event-blocks` (the event's blocks for which a configured condition holds), `won-stage`                    |
| Conditions | `suit-in`, `rank-is`, `material-is` (per block); `count-at-least`, `stage-in`                              |
| Effects    | `add-coins`, `add-coins-per-selected`, `grant-random-unowned-passive` (each adds a command)                |
| Commands   | `add-coins`, `grant-unowned-passive` (`src/rule-commands.ts`, committed against the run's `CommandTarget`) |

- **`discard.completed`:** the event carries the discarded blocks. The queue delivers it to subscribed passives left to right. Each passive's fired rules are committed as it resolves, so a later passive sees the earlier ones' coins. Follow-up events, such as `passive.installed`, go to the back of the queue.
- **`stage.won`:** the stage reward ledger (`src/stage-rewards.ts`) evaluates each passive's rules on the hand still held and the stage won. It commits their commands to a copy of the state, so each row shows the coins that passive pays. Granting from a stage win installs nothing yet.

A new discard or stage-won behaviour is a handler registration (an effect, plus a command if it changes something new). No discard or reward code changes; `src/discard-rules.test.ts` proves it.

## Categories

The categories follow the Balatro community wiki's seven Joker effect types (Chips, Additive Mult, Multiplicative Mult, Chips + Additive Mult, Effect, Retrigger, Economy). We fold the four scoring types into one **Scoring** category and show the scoring operation with an accent tint instead.

Each category is a **trait** (`scoringCategory`, `economyCategory`, `effectCategory`, `retriggerCategory`), and together they form the **category facet** in `src/passive-categories.ts`. Every passive composes **exactly one** trait from the facet, naming its primary purpose (issue #81); `src/passive-categories.test.ts` enforces this for every definition. A category trait brings presentation defaults and nothing else: colours, an appearance finish, and an activation visual and sound. No rule, condition or effect reads it, and the same test checks that gameplay code never names a category trait or the scoring tints. The finish is appearance only and is unrelated to a card's gameplay material.

| Category trait      | Base colour | Finish         | Activation visual       | Activation sound             | Passives                                                               |
| ------------------- | ----------- | -------------- | ----------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| `scoringCategory`   | White       | Porcelain      | Brief white score pulse | `passive.activate.scoring`   | ×2, ×4, Carnivore, Woodworker, Crossroads, Long Haul, D6, D8, D12, D20 |
| `economyCategory`   | Green       | Brass          | Green coin glint        | `passive.activate.economy`   | Gold Standard, Scrapper, Seeing Red                                    |
| `effectCategory`    | Black       | Matte obsidian | Brief dark ripple       | `passive.activate.effect`    | Ace Exchange                                                           |
| `retriggerCategory` | Orange      | Copper         | Quick orange echo ring  | `passive.activate.retrigger` | None yet                                                               |

Card manipulation is part of Effect until a passive needs its own category.

**Scoring tint.** A scoring passive stays white porcelain; its edge and symbol take an accent from `scoringCategory { operations }`: **icy blue** for additive, **indigo** for multiplicative, **violet** for exponential. A passive with several operations blends their tints evenly. ×2, ×4 and Carnivore are multiplicative; Woodworker, Crossroads and Long Haul are additive. The tints are in `scoringTints`, in the same file.

Passives show their category's look by default. A definition may set its own `palette` only where an explicit design calls for it; none does today.

**Not yet wired:** the activation visuals and sounds are configured and their sound ids registered, but nothing plays them yet. Playing them needs passive activations reported by the event-rule work in #63.

## Definitions

Every row below also carries rack residency, an inspectable name and effect description, and appearance data. The listed `EventRule` data is the meaningful behavior configuration. The values are for the first playtest.

| Block (id)                                            | `EventRule` configuration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Visual design                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **×2** (`double-line`)                                | On `score.beforeLineFinalized`, target the current line; multiply its working score by **2**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Midnight blue cube with a large silver ×2 and a thin double border.                                                                                                                                                               |
| **×4** (`quad-line`)                                  | The same `EventRule` and effect as ×2, configured with factor **4**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Deep amethyst cube with a gold ×4 and four small corner marks.                                                                                                                                                                    |
| **Carnivore** (`carnivore`)                           | On `score.beforeBlockValue`, if the contributor's gameplay material is **meat**, multiply that block's working value by **2**. Repeat for each eligible contributor and each line scored.                                                                                                                                                                                                                                                                                                                                                                                                                         | Dark oxblood cube with restrained marbling and a pale tooth mark; red lettering remains readable.                                                                                                                                 |
| **Woodworker** (`woodworker`)                         | On `score.beforeBlockValue`, if the contributor's gameplay material is **wood**, add **3** to that block's working value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Honey-colored wood-look cube with a branded chisel mark and visible end grain.                                                                                                                                                    |
| **Crossroads** (`crossroads`)                         | On `score.beforeLineFinalized`, count blocks in the current line that also belong to a perpendicular gap-free line of at least two blocks; add **3 per such block**. Count each intersecting block once for this line even if it crosses both other axes.                                                                                                                                                                                                                                                                                                                                                         | Slate cube with three fine white axes meeting at a bright central dot.                                                                                                                                                            |
| **Long Haul** (`long-haul`)                           | On `score.beforeLineFinalized`, add **−5** when the line has exactly two blocks; add **+5** when it has three or more.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Split charcoal and cream cube: a short dotted stroke below and a longer rising stroke above.                                                                                                                                      |
| **Scrapper** (`scrapper`)                             | On `discard.completed`, count all blocks discarded by that one action; add **1 coin per block**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Worn steel cube with a stamped scrap mark and a small gold coin inset.                                                                                                                                                            |
| **Seeing Red** (`seeing-red`)                         | On `discard.completed`, count discarded blocks whose suit is Hearts or Diamonds; add **1 coin per matching block**. This stacks with Scrapper.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Cream cube with paired red ♥ and ♦ marks, red edge stitching.                                                                                                                                                                     |
| **Ace Exchange** (`ace-exchange`, working name)       | On `discard.completed`, if the action contains **at least two Aces**, grant **one** random passive definition the player does not already own. Trigger once for the action, including a three- or four-Ace discard.                                                                                                                                                                                                                                                                                                                                                                                               | Violet cube with two overlapping A marks and a small empty-slot sparkle.                                                                                                                                                          |
| **D6, D8, D12, D20** (`d6`, `d8`, `d10`, `d20`) (#97) | On `score.afterLineClamp`, target the current line and add a **roll** (`add-line-score` with `amount: { valueSource: "roll", sides: N }`). Each die rolls **once per scoring resolution**, from the run's seeded random source (#134), before any candidate hand is evaluated. The same result goes to **every** scored line. The bonus comes **after** the line's zero clamp, so it can't rescue a negative line. Dice roll independently, and every die's roll applies to every line. Shop: D6 round 1, 4 coins; D8 round 2, 5 coins; D12 round 3, 6 coins; D20 round 4, 9 coins (`additiveScoring` frequency). | Real dice: a cube with pips (D6), an octahedron (D8), a dodecahedron (D12) and an icosahedron (D20), with faces 1–N and opposite faces summing to N+1 (#125's registered shapes). Only the tokens change shape; cards stay cubes. |

### Token shapes and face artwork (#125)

A passive's look is data on its definition: an optional `shape` and optional `faces`. `src/passive-visual.ts` builds every token, in the rack and in the shop, from that data:

- **Shape:** the name of a registered shape (`cube`, `octahedron`, `d10` for a pentagonal trapezohedron, `icosahedron`). Each shape registers only its geometry in `passiveShapes`, and the builder never asks which shape it has. With no shape, the token is the original cube. A new shape is one registration, with no change to the rack or the shop.
- **Faces:** artwork per face in **logical order**, each a label or a standard pip pattern. Every shape places them the same way: face `i` sits opposite face `count − 1 − i`. So faces labelled 1 to N give opposite pairs summing to N + 1 (a six-sided die's 1–6, 2–5 and 3–4) with no die-specific code. With no faces, every face shows the symbol, as before.

Shapes apply to passive tokens only: cards on the field stay cubes. A token's visual finish is separate from a card's gameplay material.

The appearance trait describes a passive's **look**. A wood-look Woodworker block in the rack is not itself a scoring wood card; Carnivore and Woodworker inspect the gameplay material of card blocks contributing to a line.

For Crossroads, inspect the completed field's geometry before line scores are presented. A crossing line need only exist; its own points do not enter the condition. This prevents a scoring dependency cycle. If several lines cross the same block, each scored line receives its own bonus when it resolves.

For Ace Exchange, “owned” includes installed passives and any future passive collection, not just the rack. In the current `dev2` model, the rack is the only ownership zone. Choose uniformly from eligible registry definitions using the session's injected random source; if none remain, do nothing. `dev2` has no rack cap for this experiment. Installing the new block updates subscriptions, saves the new instance, and queues `passive.installed` after all listeners of the current discard have finished. The grant does not spend another discard or play.

## Stage-won rewards

A rule with `on: "stage.won"` pays coins when a stage is won, judged on the blocks still in the hand, and appears as its own row in the stage-won ledger (rack order). **Gold Standard** (`gold-standard`) is the first: `{ on: "stage.won", condition: { kind: "material", value: "gold" }, effect: { kind: "add-coins", amount: 1, perMatch: true } }`, one coin per gold block left in the hand. A `{ kind: "stage", kinds: ["boss"] }` condition instead tests the won stage itself, so a rule can pay for boss wins only (one flat amount, not per hand block).

### Activation feedback (#81)

When a passive's rule fires, its rack token plays its category's activation. The category's `activation` config names a registered **token effect** (`src/passive-activation-effects.ts`) with a colour, plus a registered sound:

| Category  | Effect  | Colour      | Sound                        |
| --------- | ------- | ----------- | ---------------------------- |
| Scoring   | `pulse` | white       | `passive.activate.scoring`   |
| Economy   | `pulse` | green glint | `passive.activate.economy`   |
| Effect    | `pulse` | dusk violet | `passive.activate.effect`    |
| Retrigger | `echo`  | orange      | `passive.activate.retrigger` |

- **Scoring activations** play as each line's score is shown, once per passive per line, from the line's committed `activations`.
- **Discard activations** play when the discard resolves (`GameRun.lastDiscardActivations`).
- **Reduced motion** keeps the glow and drops the swell.
- **Ignored sources:** the rack ignores sources it doesn't hold, such as a card's own material rule, whose cue is still open on #8.

This is presentation only: it shows outcomes the rules already decided, and no gameplay code reads a category.

**The look belongs to the item (#485).** A passive's activation (effect, colour and sound) is its own: a definition may compose an `activationPulse` trait with `{ effect, sfx }` to choose it, and one that doesn't gets its category's activation above as its default. The rack never chooses an effect. It only forwards the activation to the item and lends the item's token as the place to show it; the pulse itself is the shared activation pulse in [game-architecture.md](game-architecture.md), "Activation pulse".

## Dev mode and verification

On a **fresh** `dev2` run, choose two different definitions from this roster and install one instance of each, in chosen rack order. Reloading a saved run preserves its rack and coin balance rather than drawing again. Give card blocks randomized gameplay materials so Carnivore and Woodworker can actually be tried. A new-game action redraws the pair.

Verify at least: order-sensitive combinations with ×2 and Long Haul; a meat or wood block contributing to two lines; Crossroads on X/Y/Z intersections; a multi-block discard with both Scrapper and Seeing Red; two Aces in one discard creating exactly one unowned passive; exhaustion of eligible passives; and save/reload preserving the awarded coins and newly installed block. Score presentation must use the same final line results as the stage total.

For lines longer than five, compare five-block candidate hands using the same configured score calculation, but make candidate evaluation side-effect free. Only the chosen result may emit coin, install, or presentation effects. The precise tie-break rule remains the one in [game.md](game.md).

## D12 target revision

The owner-approved [D12 replacement contract](dice-replacement.md) changes the former D10 slot to a 1–12 dodecahedral die. The persisted opaque definition handle remains `d10`; labels and rule configuration change, not generic dispatch or instance identity. Existing shape registrations may remain reusable even when no active definition selects them. Implementation is separate after this document merges.
