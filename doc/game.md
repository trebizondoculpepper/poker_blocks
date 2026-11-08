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
- **Discard:** select blocks in the hand and discard them, including before the first play. This uses one discard and does not score. _(How many blocks one discard can remove is to be decided.)_

After either action, the hand is refilled to 5 blocks from the deck, or until the deck runs out.

A modifier block that works while held stays active as long as it is in the hand. Playing it ends that held effect, though it may have another effect once placed. So keeping a modifier in hand means giving up a hand slot.

### Winning and losing a stage

- The stage is **won** as soon as the running total reaches the target score, provided plays have not run out. The player then earns the stage's coin reward.
- The stage is **lost** if the last play is used and the running total is still short of the target. A lost stage ends the run.

The field is cleared at the end of every stage. Placed blocks return to the deck, while the discard pile remains separate and carries forward through the rest of the round. The next stage starts with an empty field and dealer-set play and discard allowances. What happens to cards still in the hand, and whether discarded blocks return to the deck after the shop, are still to be decided.

## Scoring

### Running total

After every play, **every line on the field** is scored, and the sum is added to the stage's running total. A line that already existed scores again on every later play. Lines built early therefore keep paying, which makes the order of placements a key decision.

### Scoring presentation (proposal)

After each play, calculate the scores of all lines along the X, Y and Z axes before starting feedback. Each scored result identifies its axis, cells, ordered blocks, contributing cards, hand type and points. Keep lines that score at least one point, then sort them from lowest to highest score. Present them in that order, with the highest-scoring line last. For each line, request the **tint row** field visual effect on its blocks and play a sound chosen through the SFX registry. Low-scoring lines should sound modest; higher-scoring lines should use progressively more grand sounds. The score calculation is independent of the visual and sound playback.

**Tint row** only changes how a line's blocks look temporarily. It accepts the target block IDs, a duration, and optionally a color or other shader parameters. Blue is the initial color. Here, “row” includes a line along any axis. The effect does not change card identities, materials, or scores, and should remain distinguishable when a block is also selected.

The duration, exact timing between lines, how to show each hand name and points, the score-to-sound mapping, and a tie-break order for equally scoring lines are still to be designed.

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

The initial, unmodified line score is **the sum of the contributing blocks' scorable base values multiplied by the hand multiplier**. A card block's configured `scorable` trait supplies that base value: number cards use their printed number, J = 11, Q = 12, K = 13 and A = 14. The scorer reads this trait rather than deriving points from a block type. The `identifiable` trait supplies rank and suit for poker-hand recognition and reusable conditions such as face card, number card, or suit membership. Only blocks contributing to the chosen hand enter the sum. A line with fewer than two blocks scores zero.

| Hand            | Contributing cards | Multiplier |
| --------------- | ------------------ | ---------: |
| High card       | Highest card       |         ×1 |
| Pair            | Matching two       |         ×2 |
| Two pair        | Both pairs         |         ×2 |
| Three of a kind | Matching three     |         ×3 |
| Straight        | All five           |         ×3 |
| Flush           | All five           |         ×4 |
| Full house      | All five           |         ×5 |
| Four of a kind  | Matching four      |         ×7 |
| Straight flush  | All five           |         ×9 |

For example, a pair of sevens scores `(7 + 7) × 2 = 28`, while three sevens score `(7 + 7 + 7) × 3 = 63`. Distinct J, Q, K and A values preserve rank order within a hand type. This generally rewards stronger poker hands but does not enforce a strict hierarchy between hand types: a high pair may outscore a low three of a kind. These multipliers are starting values for playtesting. Materials, passive cards and other modifiers may later alter the score; their formulas and order are still open.

The basic scorer should be a pure function, **`scoreLine(blocks)`**, that accepts the blocks of one already identified contiguous line and returns its unmodified numeric score. It must not find lines, change `GameState`, add to the stage running total, play sounds or run visual effects. A separate scoring pass calls it for every line after each play and adds the sum to the running total, including scores from lines that already existed on earlier plays. A companion hand evaluation may return the hand type and contributing block IDs for presentation.

## Coins

- Winning a stage earns a fixed number of coins (_tune_).
- Some blocks have economic effects: certain plays earn coins.
- The player must balance building points against earning coins.

## Passives (design)

Passive blocks live in a registry of definitions. Each definition has a stable id, name, visual design or icon, configured traits, and optional visual effect ids for its triggers. The passive is still a block instance; reusable trait implementations contain its behavior code, so neither the block nor its registry entry needs one-off behavior attached directly to it.

An installed passive reacts to defined gameplay events. For example, an `onPlace` trigger could award coins proportional to the placed card's rank. A passive's own configuration determines when its condition is met and whether it can trigger without limit, a fixed number of times, or only once. A one-use passive destroys itself after triggering. Triggered visual effects are presentation requests and do not determine the gameplay result.

Those events can occur anywhere in the game loop: before the first play of a stage, when a block is played, while a line's score is being prepared, after a line is scored, after the whole field is scored, or at victory or loss. Each trigger has an explicit moment and event context so a trait can test its condition. Score-changing effects must resolve before their score is finalized; reactions to a finalized score happen afterward. The event and effect coordinator, rather than the pure `scoreLine` function, runs these responses.

Simple passive examples are **×2** and **×4** blocks, with matching icons, that multiply each line's score. By default, passives responding to the same event resolve **left to right in the rack**, unless a trait explicitly defines another timing rule. Players may reorder installed passives by dragging them between rack slots. Order can matter when future effects combine addition and multiplication; for example, adding 10 before doubling differs from doubling before adding 10.

Players may also reorder blocks within the hand by dragging between hand slots. Reordering either area changes its stored order but does not play, discard, score, or consume an allowance. Dragging from the hand onto the field or discard area, or from the rack onto the sell target, remains a separate action.

The rack is separate from the hand and field. Passives are not discardable. Dragging one to a dedicated sell target beside the discard area removes it from the rack and grants coins; selling is available outside the shop. Rack capacity, sale value, and the exact path from shop or deck into the rack are still to be designed.

## A run

- A **round** contains three stages. Stage one has a lower score target than stage two. The **third is a boss stage**, which may add rules or restrictions.
- After each boss stage there is a **shop**.
- Target scores rise as the run goes on (_tune_).
- A run is **won** by beating a fixed number of rounds (_tune_). Losing any stage ends the run.
- The deck, including blocks bought at the shop, carries over from round to round for the whole run.

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
5. **Discards:** how many blocks one discard can remove.
6. **Removal:** whether blocks can be destroyed or removed from the field, what happens to parts of the structure that end up disconnected, and whether a destroyed block also leaves the deck.
7. **Effect order on the field:** the fixed order in which line scores and block effects resolve (for example, placement order).
8. **Boss rules:** the list of boss restrictions and extra rules.
9. **Numbers to tune:** plays and discards per stage, target scores, coin rewards, shop prices, and run length.
10. **Straights:** whether aces count both high and low, and whether a straight can wrap around (K-A-2).
11. **Naming:** the game's own name for modifier blocks.
12. **Scoring feedback:** the blue line-highlight duration, line order, and where to show each hand name and score; how the highlight combines with selection and other temporary effects.
13. **Stage boundary:** what happens to cards still in the hand, how the empty field signals its opening drop target, and whether the discard pile returns to the deck after the shop.
14. **Passives:** rack capacity, sale value, shop/deck installation flow, and how a one-use passive is removed from the player's collection after it triggers.
