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
- **Hand:** up to 5 blocks drawn from the deck.
- **Field:** the structure of blocks placed this stage. It is built in an unbounded 3D grid of cells around a centre block.
- **Coins:** the currency, spent at the shop.

## A stage

A **round** contains three stages. Stage one has a lower score target, stage two has a higher target, and stage three is a boss stage that may modify the rules. The shop follows the boss stage. The deck and discard pile carry across stages within the round; see [terms.md](terms.md) for the canonical definitions.

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

After either action, the hand is refilled from the deck up to the stage dealer's hand size (5 for the base dealer), or until the deck runs out. Drawn blocks take the places of the ones that were played or discarded.

At any time the player can also drag a block within the hand to change its position. Reordering is free: it is not a play or discard, uses nothing and does not refill the hand. Hand order matters for effects that read it, and it is saved with the run.

A modifier block that works while held stays active as long as it is in the hand. Playing it ends that held effect, though it may have another effect once placed. So keeping a modifier in hand means giving up a hand slot.

### Winning and losing a stage

- The stage is **won** as soon as the running total reaches the target score, provided plays have not run out. Play the stage-win sound and show **Stage complete** before advancing.
- The stage is **lost** if the last play is used and the running total is still short of the target. A lost stage ends the run.

On a win, show a reward ledger with one row for each rule that grants coins. The default rule grants **4 coins for completing the stage**; future traits or passives may add other rows. The ledger shows each row's coins and the total added to the player's finances. Stage score is not a currency and resets to zero when the next stage begins. The player chooses when to continue: after stage 1 or 2, a button starts the next stage; after the boss stage, it opens the shop.

The session controller owns the reward and transition sequence. Coins persist from one stage to the next, including the boss stage and shop, until the player spends them. Stage lifecycle events carry the round number and stage kind so passive traits can react to a specific moment, such as the first stage or a boss stage. A passive may add an itemized reward, such as interest on the coins already held, before the ledger and new balance are finalized.

The field is cleared at the end of every stage. Placed blocks return to the deck, and the next stage starts with an empty field. The deck and the discard pile carry over between the stages of a round, so a block discarded in stage 1 cannot be drawn in stage 2 or the boss stage.

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
- **Stage won screen (built):** when a stage is won, a "Stage Won" pop-up counts in the reward ledger one row every quarter second, each with a cash sound (`reward.coin`): first the **Stage complete bonus (4 coins)**, then each passive that pays on a stage win, in rack order. It then shows the total earned and the new balance, and a **Start next stage** (or, after the boss, **Visit shop**) button. The music keeps playing. Rewards are paid once per stage (`GameSession.claimStageRewards`, saved with the run), so reopening the pop-up, a reload or a second Continue never pays twice; a lost stage pays nothing.
- Completing a stage grants 4 coins by default. Other reward rules may add more ledger rows and coins.
- Some blocks have economic effects: certain plays earn coins.
- The player must balance building points against earning coins.

## Materials (design)

The default card material is **paper**. **Wood** is the next material under discussion: it should resemble a softwood block with grain running along one axis. Four side faces show lengthwise grain; the two opposite end faces have a distinct end-grain texture. Rank and suit remain readable on every face. Wood's gameplay effect is still to be decided; its position after paper does not yet imply a numerical bonus.

The playable `?room=dev0` experiment (formerly `?room=dev`) assigns a random visual material to each of the 52 cards at the start of a new game. Its own save preserves those assignments without affecting a normal run. The `?room=dev1` materials room opens on a structure with one block of every material, attached at random, for judging the substances next to each other. The current visual prototypes are:

- **Wood:** branded rank and suit, with red suits inked red.
- **Steel:** brushed steel plates, riveted at the corners; each face is brushed in its own direction and its anisotropic reflections catch the light differently as the block turns.
- **Prismatic crystal:** a solid, chamfered square-cut crystal; strongly refractive with dispersion and an iridescent sheen.
- **Fire:** an open iron frame with a raymarched, volumetric flame burning just below the centre; the rank and suit are iron lettering in the frame.
- **Gold:** warm reflective foil and engraved edges.
- **Terracotta:** rough fired clay with impressed markings.
- **Ice:** frosted glass-like blue with surface condensation.
- **Meat:** marbled flesh tones and gently rounded corners.

These prototypes have no material-specific rules yet. **Jelly** is excluded until its motion and attachment behavior are designed.

## Passives (design)

Passives are intended to be a major source of combinations throughout a run. Their effects may change line scores, how card values work, coin income, or other rules at defined moments in the game loop. Players should be able to combine these effects in unexpected ways.

Passive blocks live in a registry of definitions. Each definition has a stable id, name, visual design or icon, configured traits, and optional visual effect ids for its triggers. The passive is still a block instance; reusable trait implementations contain its behavior code, so neither the block nor its registry entry needs one-off behavior attached directly to it.

Installed passives live in an ordered rack at the top of the screen. Their passive trait declares which named game events it responds to; a passive need only subscribe to the moments relevant to its behavior. When an event arrives, its trait can test conditions and return gameplay effects, presentation requests, and, where appropriate, a request to emit another named game event. These follow the event queue and loop safeguards in [game-events.md](game-events.md), rather than calling arbitrary code on another block or controller. For example, an `onPlace` response could award coins proportional to the placed card's rank. A passive's own configuration determines whether it can trigger without limit, a fixed number of times, or only once. A one-use passive destroys itself after triggering. Triggered visual effects are presentation requests and do not determine the gameplay result.

Those events can occur anywhere in the game loop: before the first play of a stage, when a block is played, while a line's score is being prepared, after a line is scored, after the whole field is scored, or at victory or loss. Each trigger has an explicit moment and event context so a trait can test its condition. Score-changing effects must resolve before their score is finalized; reactions to a finalized score happen afterward. The event and effect coordinator, rather than the pure `scoreLine` function, runs these responses.

Simple passive examples are **×2** and **×4** blocks, with matching icons, that multiply each line's score. By default, passives responding to the same event resolve **left to right in the rack**, unless a trait explicitly defines another timing rule. Players may reorder installed passives by dragging them between rack slots. Order can matter when future effects combine addition and multiplication; for example, adding 10 before doubling differs from doubling before adding 10.

Players may also reorder blocks within the hand by dragging between hand slots. Reordering either area changes its stored order but does not play, discard, score, or consume an allowance. Dragging from the hand onto the field or discard area, or from the rack onto the sell target, remains a separate action.

The rack is separate from the hand and field. Passives are not discardable. Dragging one to a dedicated sell target beside the discard area removes it from the rack and grants coins; selling is available outside the shop. **Built (issue #16):** an installed passive can be dragged from the rack onto the shared lower-screen target, which reads **Sell** (gold) while a passive is dragged and **Discard** otherwise. A sale removes that exact passive and adds its sell value to the coins; it is not a discard and uses no play or discard. The session owns the price policy (`SessionConfig.passivePrices`, first version: buy 1, sell 1). A drop elsewhere cancels; a sale after the run is over is refused with the red X. Rack capacity and the path from shop or deck into the rack are still to be designed.

### Dev2 passive sandbox

**Rooms are composed from room traits** (`src/rooms.ts`): each room (the normal game, or a dev room opened with `?room=`) is data, an id plus traits such as `passiveRack { capacity, startWith }`, `sandbox`, `materialDeck`, `materialSample`, `skipTitle` and `quiet`, and the game reads the traits rather than asking which room it is. The passive rack is composed into the normal game (five slots, starting empty) and into dev2 (five slots, two passives dealt). The rack's capacity is enforced by the session: a full rack takes no more.

The separate `?room=dev2` sandbox reuses the endless-play session configuration from `dev1`. It deals two distinct passives from the roster below and gives standard cards a mix of gameplay materials. The rack and current run survive a reload. Each passive has configured rule, appearance, rack-residency, and inspection traits. Shop acquisition, selling, rack capacity rules, and one-use passives remain future work. `dev0` and `dev1` keep their existing purposes.

Enter `reset` in the developer console to restart the current dev room in place. In `dev2`, this draws two new, distinct passives. Add `&restart=true` to a dev-room URL for the same fresh start on load; the parameter is then removed so later reloads resume normally. An older `dev2` save with the retired Do Nothing block replaces it with active passives while retaining the card run.

### First dev2 passive set

On a fresh `dev2` run, two **distinct** passive definitions are chosen at random from this set and installed in the rack. A saved run keeps its chosen passives on reload. The dev room mixes card materials so the material effects can be exercised.

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
- After each boss stage there is a **shop**, and leaving it starts the next round.
- Target scores rise as the run goes on (_tune_).
- A run is **won** by beating a fixed number of rounds (_tune_). Losing any stage ends the run.
- The deck, including blocks bought at the shop, carries over for the whole run.

### Placeholder progression rules

The demo uses these placeholders. They live in `src/session-config.ts` so they can be replaced without changing the controller:

- **Targets:** stage 1 = 100, stage 2 = 150, boss stage = 200, each growing by half its base every round (round 2: 150, 225, 300). Every stage has 6 plays and 4 discards.
- **Boss dealer:** the boss stage uses the base dealer until boss rules exist.
- **Hand at a stage boundary:** cards left in the hand return to the deck before the next stage is dealt.
- **Discard pile after the shop:** returns to the deck when the player leaves the shop, so the deck does not run out over a long run.
- **Shop:** an empty placeholder screen with a button to start the next round.

### Shop

The shop sells **blocks**, which are added to the deck. These can be card blocks, special card blocks or modifier blocks. Prices and stock are _tune_.

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
