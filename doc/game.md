# Poker Blocks: game rules

Status: first draft, built from design interviews. Numbers marked _tune_ are placeholders to be set by playtesting. Undecided rules are listed under [Open questions](#open-questions).

How the rules are implemented (traits, events, engine) is covered in [game-architecture.md](game-architecture.md).
Term definitions are kept in [terms.md](terms.md).

## Concept

Poker Blocks is poker solitaire played in three dimensions, with modifiers. Card blocks are attached face to face to build a structure in an unbounded voxel space. Every straight line of blocks along the X, Y or Z axis scores as a poker hand. A run contains rounds of three stages; each stage has a score target to meet before its plays run out.

The game is meant to be about blocks that combine in unexpected ways. Modifiers should work together through shared properties, not through set strategies that the design prescribes.

Poker Blocks is an original IP. It draws on public-domain ideas only: standard playing cards, poker hands, poker solitaire, and modifiers in general. It does not copy names, terms or content from any other game.

## Components

- **Card block:** a cube that represents one card. Each face shows the card's rank and suit. A card block can also have a **material**, which changes how it scores (see [Scoring](#scoring)).
- **Modifier block:** a special block that changes play. Some modifier blocks work while held in the hand, and some once placed on the field.
- **Passive block:** a block that can be installed in a rack at the top of the screen. Passives are mostly bought from the shop, though some may enter the deck through game events. They are not discarded; they can be sold at any time by dragging them to a sell target next to the discard area.
- **Deck:** the player's collection of blocks. It starts as a standard 52-card deck and changes over a run. Since the deck can be modified, it may contain duplicate cards and cards a standard deck doesn't have.
- **Hand:** up to 6 blocks drawn from the deck with the base dealer; another dealer may set a different size.
- **Field:** the structure of blocks placed this stage. It is built in an unbounded 3D grid of cells around a centre block.
- **Coins:** the currency, spent at the shop.

## A stage

A **round** contains three stages. Stage one has a lower score target, stage two has a higher target, and stage three is a boss stage that may modify the rules. A skippable shop follows **each** completed stage. The deck and discard pile carry across stages within the round; see [terms.md](terms.md) for the canonical definitions.

### Setup

1. The player's deck and discard pile carry over from earlier stages in the round; a new run begins with the standard 52-card deck. A block discarded in stage one cannot be drawn in stages two or three.
2. The **field starts empty**, and the dealer fills the hand to its allowed size from the deck.
3. The player chooses a block from the hand and drags it onto the empty field to place the centre block. This uses the stage's first **play**, but it need not be the player's first action: discarding from the hand before any block is placed is allowed.
4. The dealer sets the stage's **target score**, fresh **play** allowance and fresh **discard** allowance (all _tune_). These allowances do not carry over from the previous stage.

### Turns

On each turn the player does one of the following:

- **Play:** if the field is empty, drag one block from the hand into it to place the centre block. Otherwise, drag one block from the hand onto an exposed face of any block on the field; the face's neighbouring cell must be empty. The block snaps into its cell and becomes part of the field. This uses one play, and then the field is [scored](#scoring).
- **Play a line:** with several hand blocks selected, drag them (any one carries the rest) onto a face: they are placed as a straight line running out from that face, in the order they were selected, as **one play**, and the field is scored once as a normal chain. A line that would reach a block already on the field is refused whole. On an empty field it can be the first play (the line runs east from the centre).
- **Discard:** remove one or more hand blocks, including before the first play. Select blocks and click the bin, select blocks and drag any one of them to the bin (the selection goes with it), or drag a single unselected block to the bin. Each discard uses one discard allowance however many blocks it removes, and does not score. When no discards are left, the bin refuses the drop with a red X. _(A cap on blocks per discard may come later from dealers or passives; for now the whole hand may go.)_

After either action, the hand is refilled from the deck up to the stage dealer's hand size (6 for the base dealer, from `gameTuning.baseHandSize` in `src/balance.ts`), or until the deck runs out. Surviving blocks pack left in their current order; drawn blocks join at the right.

At any time the player can also drag a block within the hand to change its position. Reordering is free: it is not a play or discard, uses nothing and does not refill the hand. Hand order matters for effects that read it, and it is saved with the run.

A modifier block that works while held stays active as long as it is in the hand. Playing it ends that held effect, though it may have another effect once placed. So keeping a modifier in hand means giving up a hand slot.

### Winning and losing a stage

- The stage is **won** as soon as the running total reaches the target score, provided plays have not run out. Play the stage-win sound and show **Stage complete** before advancing.
- The stage is **lost** if the last play is used and the running total is still short of the target. A lost stage ends the run.

On a win, show a reward ledger with one row for each rule that grants coins. The default rules grant **4 coins for completing the stage** and **1 coin for each play left unused** when it is won (a row only when any are left); future traits or passives may add other rows. The ledger shows each row's coins and the total added to the player's finances. Stage score is not a currency and resets to zero when the next stage begins. The player chooses when to visit the shop after any stage, and can leave it without buying anything.

The run controller owns the reward and transition sequence. Coins persist from one stage to the next, including the boss stage and shop, until the player spends them. Stage lifecycle events carry the round number and stage kind so passive traits can react to a specific moment, such as the first stage or a boss stage. A passive may add an itemized reward, such as interest on the coins already held, before the ledger and new balance are finalized.

The field is cleared at the end of every stage. Placed blocks return to the deck, and the next stage starts with an empty field. The deck and the discard pile carry over between the stages of a round, so a block discarded in stage 1 cannot be drawn in stage 2 or the boss stage.

### Screen layers

From back to front: the card room and table, then the HUD (its panels and controls), then the blocks on the table, then the hand and passive rack, and a block being dragged above everything. Blocks may cover a HUD panel; turn or zoom the board to see what's underneath. Zooming moves the room and blocks together, never the HUD, hand or rack (#116).

## Scoring

### Running total

After every play, **every line on the field** is scored, and the sum is added to the stage's running total. A line that already existed scores again on every later play. Lines built early therefore keep paying, which makes the order of placements a key decision.

### Scoring presentation

After each play, calculate the scores of all lines along the X, Y and Z axes before starting feedback. Each scored result identifies its axis, cells, ordered blocks, contributing cards, hand type and points. Keep lines that score at least one point, then sort them from lowest to highest score. Present them in that order, with the highest-scoring line last. For each line, tint its blocks gold and play a sound from the `score.magnitude.*` family. The score calculation is independent of the visual and sound playback.

**Tint row** only changes how a line's blocks look temporarily. Here, “row” includes a line along any axis. The effect does not change card identities, materials, or scores.

The exact timing and appearance remain open to tuning.

### Lines

- A **line** is an unbroken run of **2 or more** blocks next to each other along one axis (X, Y or Z), with no gaps.
- A block with no neighbour along an axis is not part of a line on that axis and scores nothing there.
- Each block can be part of at most three lines, one per axis.
- A line of 2 to 5 blocks scores the best poker hand its cards make.
- A line of **6 or more** blocks scores the **best 5-card hand** found among its cards.
- If a line makes no better hand, it scores as **high card**.

Line discovery should be a separate pure function, **`findScoringLines(field)`**, taking the placed blocks and their grid cells and returning every maximal, gap-free X-, Y- and Z-axis line of at least two blocks. Each line appears once with its axis and blocks in cell order; intersecting lines are separate results. The function does not score, mutate the field, or exclude a line merely because it scored on an earlier play.

### Hands

Standard poker hands apply. Only some hands are possible in lines of fewer than 5 blocks:

| Hand            | Needs     |
| --------------- | --------- |
| High card       | 2+ blocks |
| Pair            | 2+ blocks |
| Two pair        | 4+ blocks |
| Three of a kind | 3+ blocks |
| Straight        | 5 blocks  |
| Flush           | 5 blocks  |
| Full house      | 5 blocks  |
| Four of a kind  | 4+ blocks |
| Straight flush  | 5 blocks  |

Because the deck can be modified, hands that cannot happen in real poker are allowed, such as **five of a kind** (a traditional term from wild-card poker). Any other hands of this kind will get the game's own names. Their ranking and values are yet to be designed.

### Hand value

A line scores **the sum of the points of the cards that make its hand, times the hand's multiplier**. Each card's points come from its configured `scorable` trait: 2–10 score their printed number, J=11, Q=12, K=13 and A=14. Kickers do not count, except that a straight, flush, full house or straight flush counts all five cards. A line of 0 or 1 block scores 0.

| Hand            | Counted cards  | Multiplier |
| --------------- | -------------- | ---------: |
| High card       | Highest one    |          1 |
| Pair            | Matching two   |          2 |
| Two pair        | Both pairs     |          2 |
| Three of a kind | Matching three |          3 |
| Straight        | All five       |          3 |
| Flush           | All five       |          4 |
| Full house      | All five       |          5 |
| Four of a kind  | Matching four  |          7 |
| Straight flush  | All five       |          9 |

For example, a pair of sevens scores `(7+7)×2 = 28` and three sevens score `(7+7+7)×3 = 63`. Scores generally, but not strictly, follow the poker ranking: a high pair can outscore a low three of a kind. The multipliers are provisional for playtesting.

Provisional rules to confirm in review:

- **Long lines:** a line of 6 or more scores the five-card subset with the highest points. On a tie, the stronger hand type wins, then the first subset in line order.
- **Aces in straights:** aces are high only (10-J-Q-K-A). Whether A-2-3-4-5 also counts is open question 10.
- **Five of a kind** and other hands that need a modified deck are not scored yet.

Later this formula will be extended in three ways:

1. **Upgrades:** a hand type's multiplier or base can be upgraded during a run.
2. **Materials:** each card in the scoring hand can have a material that changes the hand's score.
3. **Modifier blocks:** held or placed modifiers can change scoring and play.

## Coins

- The current game starts a run with **0 coins**, keeps the balance in GameState and saved runs, and shows it beneath Moves and Discards. Stage transitions leave the balance intact.
- **Deck view (built, [#175](https://github.com/trebizondoculpepper/poker_blocks/issues/175)):** in play, the HUD's deck counter is a button. Selecting it (click, tap, Enter or Space) opens a read-only overlay listing every block still in the run's deck, in rank order from 2 to Ace, with each rank's suit and material variants grouped on its row. Hovering, focusing or tapping a block shows its details (rank, suit and material), the same text as inspecting it in play. There is no sorting, filtering or deck change. **Back** or Escape returns to play.
- **New Game confirmation (built, [#197](https://github.com/trebizondoculpepper/poker_blocks/issues/197)):** on the title screen, New Game with a saved run in progress opens a focused dialog warning that the game in progress will be lost. It offers only **Start New Game** (discards the run and starts fresh) and **Cancel** (closes the dialog; the run stays available to Continue); the title's Continue, New Game and Settings are hidden while it is up. With no saved run, New Game starts at once.
- **Stage won screen (built):** when a stage is won, a "Stage Won" pop-up counts in the reward ledger one row every quarter second, each with a cash sound (`reward.coin`): first the **Stage complete bonus (4 coins)**, then **Unused plays** (1 coin for each play left), then each passive that pays on a stage win, in rack order. It then shows the total earned and the new balance, and a **Visit shop** button. It shows no random seed: the seed and its copy action belong to the final result screen only ([#164](https://github.com/trebizondoculpepper/poker_blocks/issues/164)). The music keeps playing. Rewards are paid once per stage (`GameRun.claimStageRewards`, saved with the run), so reopening the pop-up, a reload or a second Continue never pays twice; a lost stage pays nothing.
- Completing a stage grants 4 coins by default. Other reward rules may add more ledger rows and coins.
- Some blocks have economic effects: certain plays earn coins.
- The player must balance building points against earning coins.

## Materials (design)

The default card material is **paper**. **Wood** resembles a softwood block with grain running along one axis. Four side faces show lengthwise grain; the two opposite end faces have a distinct end-grain texture. Rank and suit remain readable on every face.

The playable `?mode=dev0` experiment (formerly `?room=dev`) assigns a random visual material to each of the 52 cards at the start of a new game. Its own save preserves those assignments without affecting a normal run. The `?mode=dev1` materials mode opens on a structure with one block of every material, attached at random, for judging the substances next to each other. The current visual prototypes are:

- **Wood:** branded rank and suit, with red suits inked red.
- **Steel:** brushed steel plates, riveted at the corners; each face is brushed in its own direction and its anisotropic reflections catch the light differently as the block turns.
- **Prismatic crystal:** a solid, chamfered square-cut crystal; strongly refractive with dispersion and an iridescent sheen.
- **Fire:** an open iron frame with a raymarched, volumetric flame burning just below the centre; the rank and suit are iron lettering in the frame.
- **Gold:** warm reflective foil and engraved edges.
- **Terracotta:** rough fired clay with impressed markings.
- **Ice:** frosted glass-like blue with surface condensation.
- **Meat:** marbled flesh tones and gently rounded corners.

**Attachment sounds (#232):** when a block lands, the softer of the two materials that meet chooses the sound, so meat on steel sounds like meat. Hardness and each material's sound are data on the material; the proposed order and placeholder ids are in doc/sound_design.md. Attachment is the only material sound; there is no collision sound.

These prototypes have no material-specific rules yet. **Jelly** is excluded until its motion and attachment behavior are designed.

### Basic scoring materials (planned)

The shop's material pool expands by **round number**, through configured unlocks and stock weights rather than branches for named materials. Paper is never sold: every run starts with it. Each round's newly unlocked materials are the most common: wood in round 1, steel in 2, terracotta and custard in 3, ice, meat and fire in 4 (still leading in 5, when nothing new unlocks), gold in 6 and prismatic crystal in 7, with earlier materials still offered less often (see "Unlocks and stock weights" below). Unlocking makes a material possible in stock, not guaranteed.

| Material          | Earliest shop round | Effect when its block contributes to a scored hand                                                                                                                                                                                         |
| ----------------- | ------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Paper             |  Starting deck only | No material bonus.                                                                                                                                                                                                                         |
| Wood              |                   1 | Add a small configured amount to that block's base value; **+1** is the first tuning value.                                                                                                                                                |
| Gold              |                   6 | Add **+1** to that contributing block's base value; separately, each Gold card left in hand grants **2 coins after every stage**.                                                                                                          |
| Steel             |                   2 | Multiply the line's working score by a configured factor; the factor is still to be tuned. Conductive and resilient are possible later traits, not part of this initial effect.                                                            |
| Custard           |                   3 | Add **+2** to that block's base value, then multiply the line's working score by **1.2** (#381). Both go through the shared scoring rules; rank and suit are unchanged.                                                                    |
| Prismatic crystal |                   7 | After ordinary scoring changes, raise the line's working score to a configured power; **1.1** is the first tuning value. Each contributing prismatic applies its power in sequence, and the result is rounded only after all such effects. |

Only blocks that **contribute to the selected scoring hand** activate these material scoring effects. A block present in a longer line but excluded from its best scoring hand has no scoring effect, unless a separate modifier explicitly extends eligibility. Gold's held-card coin reward is separate and does not require the card to score. Material behavior belongs in configured traits; the line scorer supplies contributor IDs and the effect runner applies each eligible operation at its defined scoring phase. Steel strength and prismatic balance are first tuning values. **Implemented in [#141](https://github.com/trebizondoculpepper/poker_blocks/issues/141)** for wood, steel and prismatic crystal (see "Agreed model" below). Meat, fire and ice bring no scoring modifier until their design tickets decide one (#104–#106); Gold's modifier is specified below but not yet implemented. [Material design issue #8](https://github.com/trebizondoculpepper/poker_blocks/issues/8) tracks the rest.

**Ice melts (#367).** When a play settles, ice sharing a face with flame or with hot water (water holding the `heated` bonus) melts into **water** with the **melted** state bonus (+1 to its value when it contributes). Rank, suit and identity are unchanged, and the melt doesn't score the play that caused it. Edge and corner contact does nothing. Water only ever arises this way: it has no shop price, so it's never sold or unlocked.

**Flame heats water (#368).** Water sharing a face with ordinary flame becomes **hot water**: it takes the **heated** +1 bonus, which replaces any bonus it had (melted water doesn't keep both). The flame is unchanged, and hot water never cools by itself. Boiling water (#369) stays boiling beside ordinary flame.

**Air stokes flame (#370).** Flame sharing a face with Air becomes **aggressive flame**: the same card (rank, suit and identity kept), now holding the **aggressive** state, which adds no score of its own. Air is unchanged. Air is still a visual experiment (#357), so in the normal game this only happens where Air is dealt (developer modes) until Air joins the game.

**Aggressive flame boils water (#369).** Water sharing a face with aggressive flame becomes **boiling water**: the **boiled** ×2 bonus (on its line, when it contributes), replacing any bonus it had. Boiling water stays boiling: ordinary flame never downgrades it, and it never cools by itself. Beside both kinds of flame, water boils, because aggressive flame is listed first.

**Cooking (#372).** Meat has a doneness: Raw, Bloody, Rare, Medium Rare, Well Done, Overcooked. Each play, meat sharing a face with flame (aggressive flame included) or boiling water cooks one step. Two sources still give one step per play, and it stops at Overcooked. Hot water doesn't cook. The inspector shows the step ("Ace of Hearts · Meat · Rare"), and saves keep it. Meat goes back to Raw when a stage ends, after that stage's rewards are counted (#373 reads doneness first). How meat looks as it cooks is #376.

Material interactions will be built one combination at a time from configured, reusable traits, without material-name branches in the controller. The first mission is [ice beside fire](https://github.com/trebizondoculpepper/poker_blocks/issues/21): a timed destructible reaction removes melted ice, then face-connected groups settle toward the field's center of gravity before scoring. When numeric ice melts above another number card, the lower card permanently gains the ice's printed number before the field settles: 5 above 9 of Hearts makes **14 of Hearts**. Such nonstandard numeric ranks are valid in this game and must stay distinct from named Ace identity. The next mission is [meat beside fire](https://github.com/trebizondoculpepper/poker_blocks/issues/22): a `cookable` trait advances doneness over turns and a French themed passive rewards steak that is cooked but not overcooked. `Cookable` must support other ingredient progressions, such as salmon becoming opaque, flaky, then dry, through configuration. Flammable, brittle, corrodible, and conductive are possible later traits; their exact rules remain open.

### Material scoring (design, [issue #8](https://github.com/trebizondoculpepper/poker_blocks/issues/8))

This section is the target design and supersedes the table above where they differ. It records only agreed rules; open questions are listed at the end and asked on the issue.

#### Agreed model

- Every card has **exactly one** material at a time (`traits.material.kind`; paper when absent). A card's material can change during a run (a transmogrifier, #384; later, material reactions, #362). The change is permanent for the rest of the run, keeps the card's identity, rank and suit, and is saved for Continue (#387).
- First-version material behaviour is **scoring only**, and only when the card **contributes to the scored hand** of its line.
- A material's effect is a **`scoringModifier` trait** configured in the balance config, with three inputs and their neutral values: `additive` (0), `multiplicative` (1), `exponential` (1).
- Materials contribute **event rules** exactly as passives do ([#63](https://github.com/trebizondoculpepper/poker_blocks/issues/63)). `scoringModifier` (on the material's own definition in `src/materials.ts`, expanded by `src/scoring-modifier.ts`) brings one rule per non-neutral value: additive on `score.beforeBlockValue`, multiplicative on `score.lineMultiply`, and exponential on `score.linePower`. The line phases run in that order, before the rack's `score.beforeLineFinalized`. In each phase, the contributing cards' own rules run first, then the passives'. The scorer never names a material.
- When a material rule fires, that card pulses in the accent colour and plays the sound configured by its material's `activation` cue. The play presenter uses the scorer's activation source IDs while showing each line; paper has no scoring rule or cue. Reduced motion keeps the glow and removes the scale pulse.

| Material          | Additive | Multiplicative | Exponential |  Unlock round |
| ----------------- | -------: | -------------: | ----------: | ------------: |
| Paper             |        0 |              1 |           1 | starting deck |
| Wood              |       +1 |              1 |           1 |             1 |
| Gold              |       +1 |              1 |           1 |             6 |
| Steel             |        0 |           1.25 |           1 |             2 |
| Custard           |       +2 |            1.2 |           1 |             3 |
| Prismatic crystal |        0 |              1 |         1.1 |             7 |

#### Order of operations (Agreed)

1. Each contributing card's base value gets its material's **additive** value (summed if several apply), then passive `score.beforeBlockValue` effects, in rack order.
2. The line's working score is computed from block values and the ordinary hand multiplier.
3. **Multiplicative** material factors multiply the working score (all factors multiplied together).
4. **Exponential** effects apply next, one per contributing crystal, in sequence.
5. Passive `score.beforeLineFinalized` effects resolve in rack order, on the material-adjusted score. This is the owner's decision on #8: material effects come before passives.
6. Clamp at zero.
7. Passive `score.afterLineClamp` effects resolve in rack order. These are flat bonuses that can't rescue a negative line: a die adds its roll here (#97). Each die rolls once per scoring resolution, and the same roll is added to every scored line.
8. Round to an integer once, after all effects.

#### Worked examples

Values use the current hand table (a pair's base values summed, ×2 hand multiplier). Exact hand values are those in "Hand value" above; only the material arithmetic matters here.

- **Wood pair:** two wooden 7s. Base 7 + 7 → (7+1) + (7+1) = 16; ×2 = **32** (paper: 28).
- **Steel in a pair:** one steel 7 and one paper 7. 14 ×2 = 28; ×1.25 = **35**.
- **Two steels:** both 7s steel. 28 × 1.25 × 1.25 = 43.75 → **44**.
- **Crystal:** a crystal 7 and a paper 7. 28^1.1 = 39.07 → **39**.
- **Non-contributor:** a steel 3 in a line whose best hand is a pair of 7s has no effect.
- **Custard in a pair:** a custard 7 and a paper 7. (7+2+7) ×2 = 32; ×1.2 = 38.4 → **38** (#381).
- **Gold scoring:** a Gold 7 and a paper 7 score (7+1+7) ×2 = **30**; a Gold card excluded from the selected hand adds no score.

#### Gold's end-of-stage hand reward (#107, #218; built)

Each Gold card still in the hand when a stage ends grants **2 coins**, whether the stage was won or lost. The reward counts cards at stage settlement before the hand is returned to the deck, and pays once per stage; a card already played, discarded or in shop stock does not count. This is separate from Gold's +1 scoring modifier and from the **Gold Standard** passive. Gold Standard currently grants another **1 coin per Gold card left in hand on a stage win**; with that passive installed, one held Gold card therefore grants 3 coins on a win (2 from its material and 1 from the passive), in addition to the ordinary completion bonus. A loss gets the material's 2 coins before the run ends and no Gold Standard stage-win reward. Scoring while merely held in hand remains deferred.

Gold's material definition carries the +1 scoring modifier, a pulse and registered activation sound, and `handReward: { coinsPerCard: 2 }`. The shared material handler counts held cards and adds one material row to the won-stage ledger before passive rows. With one held Gold, a win pays the 4-coin completion bonus and the unused-plays row, plus 2 material coins; Gold Standard adds 1 more. A loss pays just the 2 material coins before game over. The paid-stage marker survives save/Continue, and malformed coin totals or reward markers invalidate the save. Gold's shop weight curve unlocks it in round 6; the balance validator checks its round and reward rate.

#### Balance config guardrails

- One config entry per material holds its traits and values, including any end-of-stage hand reward; nothing else holds material numbers.
- Validation (at load and in a test): `additive` is a finite number, `multiplicative` and `exponential` are positive, unlock rounds are positive integers, and keyframes are ordered (see the shop rules).
- A guardrail test confirms the scorer and effect runner contain no material ids.

#### Open questions

Asked on [issue #8](https://github.com/trebizondoculpepper/poker_blocks/issues/8): inspection text. Material cues are implemented in #212; save behavior is documented in `doc/game-architecture.md` (#214). Decided: material line effects resolve before passives. Meat, flame and ice are designed in #104–#106; Gold's design is above (#107). Steel and crystal strengths are first tuning values.

## Passives (design)

Passives are intended to be a major source of combinations throughout a run. Their effects may change line scores, how card values work, coin income, or other rules at defined moments in the game loop. Players should be able to combine these effects in unexpected ways.

Passive blocks live in a registry of definitions. Each definition has a stable id, name, visual design or icon, configured traits, and optional visual effect ids for its triggers. The passive is still a block instance; reusable trait implementations contain its behavior code, so neither the block nor its registry entry needs one-off behavior attached directly to it.

Installed passives live in an ordered rack at the top of the screen. Their passive trait declares which named game events it responds to; a passive need only subscribe to the moments relevant to its behavior. When an event arrives, its trait can test conditions and return gameplay effects, presentation requests, and, where appropriate, a request to emit another named game event. These follow the event queue and loop safeguards in [game-events.md](game-events.md), rather than calling arbitrary code on another block or controller. For example, an `onPlace` response could award coins proportional to the placed card's rank. A passive's own configuration determines whether it can trigger without limit, a fixed number of times, or only once. A one-use passive destroys itself after triggering. Triggered visual effects are presentation requests and do not determine the gameplay result.

Those events can occur anywhere in the game loop: before the first play of a stage, when a block is played, while a line's score is being prepared, after a line is scored, after the whole field is scored, or at victory or loss. Each trigger has an explicit moment and event context so a trait can test its condition. Score-changing effects must resolve before their score is finalized; reactions to a finalized score happen afterward. The event and effect coordinator, rather than the pure `scoreLine` function, runs these responses.

Each passive has one **category** (Scoring, Economy, Effect or Retrigger) that sets its default look, activation effect and sound, and never its behaviour. Scoring passives are white porcelain with an accent showing their operation: icy blue for additive, indigo for multiplicative, violet for exponential. See [passives.md](passives.md), "Categories".

Simple passive examples are **×2** and **×4** blocks, with matching icons, that multiply each line's score. By default, passives responding to the same event resolve **left to right in the rack**, unless a trait explicitly defines another timing rule. Players may reorder installed passives by dragging them between rack slots. Order can matter when future effects combine addition and multiplication; for example, adding 10 before doubling differs from doubling before adding 10.

Players may also reorder blocks within the hand by dragging between hand slots. Reordering either area changes its stored order but does not play, discard, score, or consume an allowance. Dragging from the hand onto the field or discard area, or from the rack onto the sell target, remains a separate action. **Built in [issue #4](https://github.com/trebizondoculpepper/poker_blocks/issues/4):** dragging a passive over the rack previews the drop slot (neighbours glide aside); dropping there moves it (`GameRun.reorderPassive`), a drop past the last passive moves it to the end, and a drop off the rack or a cancelled drag restores the order. The new order is saved with the run and re-subscribes passive events, so scoring, stage rewards and events all resolve in the new left-to-right order. Reordering is refused once the run is over.

The rack is separate from the hand and field. Passives are not discardable. **Built in [issue #16](https://github.com/trebizondoculpepper/poker_blocks/issues/16):** an installed passive can be dragged from the rack onto the shared lower-screen target, which reads **Sell** (gold) while a passive is dragged and **Discard** otherwise. A sale removes that exact passive and adds its sell value to the coins; it is not a discard and uses no play or discard. **Resale ([#103](https://github.com/trebizondoculpepper/poker_blocks/issues/103)):** a passive sells for half its base purchase price from the balance config, rounded down, with a minimum of 1 coin: a 2-coin passive sells for 1, a 5-coin passive for 2, a 9-coin passive for 4. The game run applies this policy, then any resale modifiers the run configures (none yet; future passives may add them). Buying a passive costs its base price ([#144](https://github.com/trebizondoculpepper/poker_blocks/issues/144)). A drop elsewhere cancels; a sale after the run is over is refused with the red X. Rack capacity and the path from shop or deck into the rack are still to be designed.

### Dev2 passive sandbox

**Game modes** (`GameMode`, in `src/game-modes.ts`) describe available scenes, the initial scene, mode-wide configuration, and **run setup**. Use `?mode=dev0` through `?mode=dev4` for the developer modes; old `?room=` links are still accepted as aliases.

A mode's **run setup** is the ordered list of steps it applies when a _new_ game run is created: choosing the deck (a material mix and its seed), adjusting the run rules (a sandbox), or preparing the start (a sample structure, a filled rack, a stocked shop). Steps compose in declared order, and each step's meaning lives in one registry rather than in the run controller. Run setup never applies to Continue: a saved run is restored exactly as saved, and its deck is rebuilt from the seed stored in that run.

Where a mode opens and whether it continues are separate decisions. `startScene` picks the scene a fresh page opens on, and the `resumeSavedRun` trait says that a mode opening in play continues its saved run. A mode without it always deals a new run on load — which is why `dev1`'s sandbox never carries a half-played run across a reload.

Which HUD panels appear, and where blocks may be played, belongs to the **scene** in front rather than to the mode: the stage scenes show the round and deck panels and allow placement, and the shop scene shows the coin panel and its exit and owns its stock. Mode traits keep only mode-wide configuration: the save key, the console and restartable traits, the rack and shop configuration, and the music. The passive rack is enabled in the normal game (five slots, starting empty) and in dev2 (five slots, two passives dealt). `GameRun` enforces the rack capacity.

The separate `?mode=dev2` sandbox uses the endless-play `RunRules` as dev1. It deals two distinct passives from the roster below and gives standard cards a mix of gameplay materials. The rack and current run survive a reload. Each passive has configured rule, appearance, rack-residency, and inspection traits. Shop acquisition and one-use passives remain future work. `dev0` and `dev1` keep their existing purposes.

Enter `reset` in the developer console to restart the current dev mode in place. In `dev2`, this draws two new, distinct passives. Add `&restart=true` to a mode URL for the same fresh start on load; the parameter is then removed so later reloads resume normally. A save naming the retired Do Nothing block drops it rather than carrying a slot with no effect.

### Dev3 shop sandbox

`?mode=dev3` skips the title screen and opens directly in the shop scene with five coins and a round-1 stock of 5–9 offers. Drag an offer to BUY: a passive costs its base price (2–9 coins) and enters the rack; a card costs its material's price plus its rank's surcharge and enters the deck. It has its own saved run; `reset` in the developer console or `&restart=true` in the URL starts the shop again with five coins and fresh offers. This is a shop sandbox; the full shop flow remains [issue #18](https://github.com/trebizondoculpepper/poker_blocks/issues/18). In any mode, the console command `coins` shows the balance, `coins +5` adds five, and `coins -2` removes two (stopping at zero). Changes update the HUD and saved run.

### Developer shop balance editor (#161)

Run the development server and open `?mode=dev8` to edit a **draft** of the shop balance. It starts from the current values in the game: stock range and guaranteed counts, card-rank surcharges, each shop material’s price and weight curve, each passive’s price and unlock round, and the named passive frequency curves. Select an entry on the left to see its controls and a graph of relative weight by round. Drag a graph point or change its round/weight fields; **Add keyframe** and **Remove** edit the curve. Curves interpolate in straight lines and stay at their last value after the final keyframe. A passive’s graph edits its named shared curve, so every passive using that curve is affected in the draft.

Errors appear in the status bar and highlight the affected fields. An invalid price, unlock round, stock count, keyframe order or weight, unknown entry, or unsupported value disables export. **Copy complete JSON** and **Download JSON** export every shop setting, not just the changes. The editor never changes the active run, the live shop, saved games or the source files; **Back to game** leaves it and discards the draft. To apply it, give the JSON to the source-update workflow (for example, paste it into an LLM request to update the definitions in `src/game-modes.ts`, `src/balance.ts`, `src/materials.ts`, `src/passives.ts` and `src/offer-weights.ts`), run validation, and restart the game. The JSON is a reviewable draft, not a runtime import format.

### Destructible blocks and the Dev4 destruction sandbox

A block can be **destructible**: its `destructible { by }` trait names what may destroy it. Destroying a block removes it from the field. It costs no play or discard and does not change the score. Nothing settles into the gap, so blocks it held up stay where they are, even floating; settling will be a separate trait. The destroyed card goes to the discard pile, out of play like a discard, and returns to the deck whenever the discard pile does. Destruction emits `block.destroyed`, not a discard event. The only cause today is `manual`; later causes such as melting (#21) or bombs (#24) name their own.

`?mode=dev4` is a destruction sandbox. It opens on a mixed-material structure in sandbox mode (unlimited plays and discards, no win or loss). About half the cards are destructible (always the same cards), and their hover description ends in "Destructible". Double-click a block on the table to destroy it; a block that isn't destructible is refused with the denied sound. The double-click comes from the `devManualBlockDestroyer` scene trait, and the half-and-half mix from the `destructibleMix` run setup step. Both are testing-only. The mode keeps its own saved run; `reset` or `&restart=true` starts it fresh.

### First dev2 passive set

On a fresh `dev2` run, two **distinct** passive definitions are chosen at random from this set and installed in the rack. A saved run keeps its chosen passives on reload. The dev mode mixes card materials so the material effects can be exercised.

The reusable trait configurations, trigger timing, and visual design for each block are specified in [passives.md](passives.md). The names and initial values are for playtesting; the mechanics live in traits rather than block-specific code.

| Passive                           | Trigger and effect                                                                                                                                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **×2**                            | Double each line's working score before that line is finalized.                                                                                                                                                                                          |
| **×4**                            | Multiply each line's working score by four using the same trait as ×2 with a different factor.                                                                                                                                                           |
| **Carnivore**                     | Double each contributing meat block's base value before calculating its line score.                                                                                                                                                                      |
| **Woodworker**                    | Add three to each contributing wood block's base value before calculating its line score.                                                                                                                                                                |
| **Crossroads**                    | Add three points for each block in a scored line that also belongs to a perpendicular line of at least two blocks. Check line geometry, not the other line's score, so the result has no scoring cycle.                                                  |
| **Long Haul** _(working name)_    | Penalize two-block lines and reward lines of three or more blocks. Provisional values: −5 or +5 to the line's working score.                                                                                                                             |
| **Scrapper**                      | Gain one coin per block discarded in a discard action.                                                                                                                                                                                                   |
| **Seeing Red**                    | Gain one coin per Heart or Diamond block discarded. This can combine with Scrapper.                                                                                                                                                                      |
| **Ace Exchange** _(working name)_ | When one discard action includes at least two Aces, create one random passive definition the player does not currently own. Trigger once for that discard even if it includes three or four Aces. If every eligible definition is owned, create nothing. |

The two-Ace effect is a first use case for an event leading to another event: the discard completes, the effect creates and installs the passive, then the queue reports that installation after the discard's current listeners finish.

## A run

- A **round** is three stages: **stage 1**, **stage 2** and the **boss stage**. Stage 1 has a lower target than stage 2. The boss stage can use a different dealer, which adds extra rules or restrictions for more challenge.
- A skippable shop follows every completed stage. Leaving the boss-stage shop starts the next round. See [issue #23](https://github.com/trebizondoculpepper/poker_blocks/issues/23).
- Target scores follow the configured stage progression below.
- A run is **won** by beating a fixed number of rounds (_tune_). Losing any stage ends the run.
- The deck, including blocks bought at the shop, carries over for the whole run.

### Placeholder progression rules

The remaining demo placeholders live in `src/run-rules.ts` so they can be replaced without changing the controller:

- **Plays and discards:** every stage has 6 plays and 4 discards. Targets use the implemented stage-target progression below.
- **Boss dealer:** the boss stage uses the base dealer until boss rules exist.
- **Hand at a stage boundary:** cards left in the hand return to the deck before the next stage is dealt.
- **Discard pile after the boss-stage shop:** returns to the deck after the boss stage, so discards remain unavailable in stage 2 and the boss stage but the deck does not run out over a long run.
- **Shop:** follows each completed stage and offers two passives, at their base prices, and three playable blocks at one coin each. The player can leave without buying.

### Shop

The shop is a mode feature presented through the **shop scene**. Its configuration supplies the number of passive and playable-card offers, while the active mode enables the shop alongside the table, hand, passive rack, and run rules. Dev3 starts directly in this composed shop; the normal game activates it after every won stage. Field placement is a separate stage-scene trait and is absent while the shop scene is active. Shop stock uses the same 3D cube appearances as playable and passive blocks, and each offer exposes its inspectable description on hover or keyboard focus. The shop presentation can independently move the camera to frame the offers where they land on the table.

The shop opens after each completed stage with **5–9 offers** at rest on the table, drawn by round and weight ([#145](https://github.com/trebizondoculpepper/poker_blocks/issues/145), see "Drawing stock" below): passives first, then playable blocks. A passive costs its **base price** from the catalogue below (#144); a playable block is a **new card of a material** ([#143](https://github.com/trebizondoculpepper/poker_blocks/issues/143)), not one borrowed from the deck, and may repeat a card the deck already holds. It costs its material's base price (ice 2, wood 3, terracotta 3, custard 3, steel 4, fire 4, meat 6, gold 8, prismatic crystal 12 coins; paper is never offered, since every run starts with it) plus a rank surcharge: nothing for 2–10, 1 coin for J, Q and K, 2 coins for an ace. Prices live on the material definitions and the surcharge in the balance config (`src/balance.ts`). Buying requires enough coins. The player drags either offer to BUY. A bought passive enters the passive rack; a bought card enters the deck. The player can drag an installed passive to SELL for its resale price. A bought card **joins the run's deck**, not the hand, and carries into later stages; saves record it in full. Active cards can't be sold; paid removal is [#156](https://github.com/trebizondoculpepper/poker_blocks/issues/156). A card offer's material is drawn by its weight curve; its rank and suit are drawn evenly. Future shop stock may include special cards and modifier blocks. The player can continue to the next stage without spending coins.

**Transmogrifiers (#384, #388).** Each shop also has `transmogrifierSlots` dedicated transmogrifier offers (default 1, at most 2), in addition to the ordinary offers. The shop still holds at most nine offers, so the ordinary draw shrinks when it must. A transmogrifier is an Items-rack item that turns a card into its material (applying it is #389). There is one for every material with a transmogrifier price. By default the price is twice the material's base price, with no rank surcharge (wood 6, ice 4, terracotta 6, custard 6, steel 8, fire 8, meat 12, gold 16, prismatic crystal 24), and it is drawn by the material's own weight curve, so it unlocks with the material. Paper is never sold as a card, so it sets its own: 2 coins, offered from round 1 at a low weight (0.5). Each shop offers a material's transmogrifier at most once. A new one has 2 uses. The uses, the price multiple (2) and the slot count are balance config (`gameTuning.transmogrifier`, `transmogrifierSlots`), validated centrally and editable in the shop balance editor (dev8, #392). Its uses left and its price are saved with the rack. **Selling one (#390)** pays half its purchase price times the share of uses left, rounded down, at least 1 coin while it has uses: bought for 8, it resells for 4 unused and 2 with one use left. An exhausted transmogrifier no longer exists, so it can't be sold. Ordinary passives keep their half-price resale. **Using one (#389):** drag it from the Items rack onto a card in the hand or on the table. It changes that card's material at once, with no confirmation, and spends one use. Rank and suit are unchanged, and the change lasts for the run (#387). With uses left it goes back to its rack slot; after its last use it is gone for good. A card already of that material is refused without spending a use.

In landscape, shop stock occupies a compact two-row grid in the table centre. Coins and Settings sit in the top corners, the passive rack at top centre, BUY and SELL at bottom left, the hand at bottom centre, and Continue at bottom right. BUY shows the current deck count and identifies where each offer goes. The stage score, target, moves, discards, and deck gameplay panels are absent because the shop scene does not compose those traits. Controls remain at least 44 pixels high on short landscape screens. Leaving the shop burns unsold offers; reloading while in the shop preserves its remaining stock and purchases.

The shop entrance is a separate presentation sequence: a deliberately theatrical **SHOP OPEN** sign descends, blocks appear to be thrown onto the table by an unseen hand, and the camera moves to frame them. The items are at rest before the player interacts with them; the animation does not change stock or purchase rules.

Shop transactions and the entrance animation are tracked separately in [shop gameplay issue #18](https://github.com/trebizondoculpepper/poker_blocks/issues/18) and [shop presentation issue #19](https://github.com/trebizondoculpepper/poker_blocks/issues/19).

### Shop rules (design, [issue #7](https://github.com/trebizondoculpepper/poker_blocks/issues/7))

This section is the agreed target design. It replaces the first-version placeholders above (two passives, three cards, one coin each) once implemented ([#18](https://github.com/trebizondoculpepper/poker_blocks/issues/18)).

#### Agreed rules

- A shop follows every completed stage. Each visit generates fresh stock; unbought stock disappears on leaving. There are no rerolls in the first version.
- Stock holds **5 to 9 offers**: at least one passive and at least one playable card; the rest are drawn from the eligible pool.
- Only passives can be sold. Cards cannot be sold.
- The discard pile returns to the deck after the boss stage.
- Prices are in coins and are **fixed** base prices from the balance config. Price-changing passives are future work and will be modifiers applied on top of the base price, never edits to it.
- When two comparable passives differ only in strength, the stronger costs more (×4 > ×2, Scrapper > Seeing Red).
- Each round of the initial progression introduces at least one new item or material.

#### Passive catalogue

| Passive                                                                          | Base price | Earliest round |
| -------------------------------------------------------------------------------- | ---------: | -------------: |
| ×2                                                                               |          4 |              1 |
| ×4                                                                               |          9 |              2 |
| Gold Standard                                                                    |          5 |       6 (gold) |
| Carnivore                                                                        |          3 |       4 (meat) |
| Woodworker                                                                       |          4 |       1 (wood) |
| Crossroads                                                                       |          2 |              1 |
| Long Haul                                                                        |          4 |              1 |
| Seeing Red                                                                       |          6 |              1 |
| Scrapper                                                                         |          8 |              2 |
| Ace Exchange                                                                     |          5 |              2 |
| Le Chef ([#104](https://github.com/trebizondoculpepper/poker_blocks/issues/104)) |          5 |       3 (meat) |

A passive whose effect names a material is never eligible before that material unlocks. The shop derives this from the passive's own rules (any material its rule configuration names) and the material's weight curve, and applies the same rule when stocking and when buying, so a stale or early offer is refused ([#165](https://github.com/trebizondoculpepper/poker_blocks/issues/165)). Balance validation fails a passive whose unlock round is earlier than a material it names.

#### Unlocks and stock weights

Material unlocks by round: 1 wood; 2 steel; 3 terracotta and custard (#381); 4 ice, meat and fire; 6 gold; 7 prismatic crystal. Paper is never offered. Each material is the most common offer in its unlock round, then rarer but still offered.

Every offer type in the balance config has a **minimum unlock round**, a **default weight** and optional **weight keyframes** by round. A type is eligible from its unlock round. Its weight is interpolated linearly between keyframes and holds the last keyframe's value afterwards. Drawing normalizes the eligible weights; weights are relative, not probabilities.

Built in [#145](https://github.com/trebizondoculpepper/poker_blocks/issues/145). A material's curve is on its definition (`shop.weights` in `src/materials.ts`); before its first keyframe it is locked (weight 0), and a weight of 0 makes it ineligible.

| Material card                                                        | Weight keyframes                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------- |
| Paper                                                                | Never offered (every run starts with it)              |
| Each other material, in its unlock round _r_ (see the unlocks above) | 4 at _r_, 1.5 at _r_ + 1, then 1 from _r_ + 2 onwards |

Passives are drawn from their unlock round by a named frequency curve (`shop.frequency` on the passive, curves in `src/offer-weights.ts`). Labels map to weights: common 4, uncommon 2, rare 1, absent 0. Passives the run already owns are not offered, and a shop offers each passive at most once; card offers may repeat cards the deck holds.

| Rounds | Additive scoring | Multiplicative scoring | Exponential scoring | Other passives |
| ------ | ---------------: | ---------------------: | ------------------: | -------------: |
| 1–2    |       common (4) |               rare (1) |          absent (0) |              1 |
| 3–4    |         rare (1) |             common (4) |            rare (1) |              1 |
| 5–6    |     uncommon (2) |             common (4) |        uncommon (2) |              1 |
| 7+     |     uncommon (2) |             common (4) |          common (4) |              1 |

#### Stage targets

Round 1 stage 1 targets **300**. Each next target is the previous one ×1.75 (stage 1 → stage 2), ×1.5 (stage 2 → boss) and ×1.25 (boss → next round's stage 1), rounded to the nearest integer at each step: 300, 525, 788, 985, 1724, 2586, … The opening target and each stage's incoming rate are balance data in `src/balance.ts`. This progression is implemented; existing saves keep their current stage target until the next stage is dealt.

An endless run eventually reaches the numeric limit. Targets then stay at `Number.MAX_SAFE_INTEGER`, so a far-round shop transition remains valid and saved targets stay representable.

#### Balance config guardrails

- **One source of truth:** prices, unlock rounds, weights and keyframes live on their definition owners and shared tuning modules; the editor reads those same values and never holds a duplicate default table. Material effects and stage target rates also remain in their definition or balance modules.
- **Validation at load (and in a test):** every price is a positive integer; unlock rounds are positive integers; weights are non-negative; keyframe rounds are strictly increasing and not before the unlock round; every passive that names a material unlocks no earlier than that material.
- **Base prices are data; modifiers are separate:** a future price-changing passive is an event rule that adjusts a working price, never an edit to the config.

#### Drawing stock

The shop's size is drawn evenly from 5 to 9 each visit (the mode's `shop` trait sets the range). Stock meets its minimums first, then follows the weights: one offer is drawn from the eligible passives and one from the eligible playable cards, and the remaining slots are filled from the whole eligible pool by normalized weight.

#### Buying, selling and leaving

- **A bought playable card joins the run's deck** ([#143](https://github.com/trebizondoculpepper/poker_blocks/issues/143)).
- **A bought passive is dragged into a free rack slot** and installs there immediately. The rack has a fixed capacity; while it is full, a passive can't be bought until one is sold.
- **Selling** a passive works at any time, in a stage or in the shop ([#16](https://github.com/trebizondoculpepper/poker_blocks/issues/16)). It pays half the passive's base price, rounded down, with a minimum of 1 coin ([#103](https://github.com/trebizondoculpepper/poker_blocks/issues/103)); future passives may modify the payout.
- **Refusals** (too few coins, a full rack) use the shared refused feedback: `action.denied` and the red X ([#18](https://github.com/trebizondoculpepper/poker_blocks/issues/18)). Nothing is spent.
- **Leaving** through the shop exit discards unbought stock and continues to the next stage, or to the next round after the boss's shop.

| Example       | Before                         | Action                        | After                                |
| ------------- | ------------------------------ | ----------------------------- | ------------------------------------ |
| Buy           | 6 coins, ×2 offered at 4       | Drag ×2 into a free rack slot | 2 coins; ×2 installed; offer gone    |
| Too few coins | 3 coins, ×2 offered at 4       | Drag ×2 to the rack           | Refused, red X; nothing changes      |
| Full rack     | Rack full, 9 coins, ×2 offered | Drag ×2 to the rack           | Refused, red X; nothing changes      |
| Sell          | Scrapper (base 8) installed    | Drag it to Sell               | +4 coins; Scrapper removed           |
| Exit          | Two offers unbought            | Press the exit                | Offers gone; the next stage is dealt |

#### State, ownership and saves

- The game run owns the stock, coins, hand, deck and rack; the shop scene only presents them. Buying, selling and leaving each apply completely or are refused with no change.
- **Ownership:** every card the player owns is in exactly one of deck, hand, field or discard pile, and every passive in exactly one of stock or rack. A purchase moves an offer from stock to its destination in one step.
- **Continue** restores purchases and the remaining stock exactly; a reload never rerolls the shop.

### Rack reorganization

The hand and passive rack share a layout rule, separate from the shop. When an item leaves either rack through play, discard, sale or another effect, the remaining items pack to the left. New items enter from the right, one at a time with a short gap between arrivals. Buying into a rack reflows the existing items to make room. This movement is visual; stored rack order determines gameplay effects only where order matters, such as passive resolution. See [rack reorganization issue #17](https://github.com/trebizondoculpepper/poker_blocks/issues/17); manual drag reordering remains [issue #4](https://github.com/trebizondoculpepper/poker_blocks/issues/4).

## Design guidelines for blocks

- **Combine through shared properties, not names.** A block's conditions should refer to general properties: rank, suit, face card, material, hand type, line, adjacency, held or placed. They should never name another specific block. For example, "+X for each Heart in its line" will combine with blocks designed later, while "boosts the Y block" rarely comes up.
- **Reuse the existing vocabulary** before inventing new keywords. A new term is only worth adding if many things will refer to it.
- **Think of each block effect as relation × condition × effect.**
  - Relations: held, placed, adjacent, in line, same axis.
  - Conditions: suit, rank, face card, material, hand type.
  - Effects: add score, multiply score, earn coins, retrigger, transform, destroy.
- **Results must be predictable.** Scoring and effects resolve in a fixed, visible order, so the player can plan a combination before making it.

## Open questions

1. **Scoring extensions:** how materials and modifiers change the base line score (for example, additive and multiplicative parts, and their order); how to choose the best five cards from a line of six or more when poker rank and numeric points disagree.
2. **Applying upgrades and materials:** the shop sells only blocks, so how hand-type upgrades and card materials are gained or applied is still undecided.
3. **Material list:** which materials exist and what each one does.
4. **New hands:** the names, ranking and values of hands that need a modified deck.
5. **Discards:** how many blocks one discard can remove. The current stage boundary returns cards left in hand to the deck, and the discard pile is recycled after the shop.
6. **Removal:** whether blocks can be destroyed or removed from the field, what happens to parts of the structure that end up disconnected, and whether a destroyed block also leaves the deck.
7. **Effect order on the field:** the fixed order in which line scores and block effects resolve (for example, placement order).
8. **Boss rules:** the list of boss restrictions and extra rules.
9. **Numbers to tune:** plays and discards per stage, target scores, coin rewards, shop prices, and run length.
10. **Straights:** whether aces count both high and low, and whether a straight can wrap around (K-A-2).
11. **Naming:** the game's own name for modifier blocks.
12. **Scoring feedback:** the gold line-highlight duration and where to show each hand name and score; how the highlight combines with selection and other temporary effects.
13. **Stage boundary:** how the empty field signals its opening drop target.
14. **Passives:** rack capacity, sale value, shop/deck installation flow, and how a one-use passive is removed from the player's collection after it triggers.

### Block titles on menus

The title and pause screens display Poker Blocks as two rows of letter blocks above their menu options. Each word moves as a rigid row, independently phased to the music. Both use the same large scale, with the longest word spanning roughly two-thirds of the viewport width. The blocks sit outside and behind the HTML menu overlay. Alongside beat dancing, each word gently precesses about its centre on a 16-second cycle, with evenly spaced phases (half a cycle apart for two words). Music synchronisation of that slow cycle is deferred. Materials and lettering fonts are chosen when each scene's title is created and stay fixed for that scene instance. Reduced motion stills the words. Menu actions and backgrounds retain their existing behavior.
