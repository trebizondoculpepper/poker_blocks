# Poker Blocks: game rules

Status: first draft, built from design interviews. Numbers marked _tune_ are placeholders to be set by playtesting. Undecided rules are listed under [Open questions](#open-questions).

How the rules are implemented (traits, events, engine) is covered in [game-architecture.md](game-architecture.md).

## Concept

Poker Blocks is poker solitaire played in three dimensions, with modifiers. Card blocks are attached face to face to build a structure in an unbounded voxel space. Every straight line of blocks along the X, Y or Z axis scores as a poker hand. The game is a run of rounds: each round's score target must be met before the plays run out.

The game is meant to be about blocks that combine in unexpected ways. Modifiers should work together through shared properties, not through set strategies that the design prescribes.

Poker Blocks is an original IP. It draws on public-domain ideas only: standard playing cards, poker hands, poker solitaire, and modifiers in general. It does not copy names, terms or content from any other game.

## Components

- **Card block:** a cube that represents one card. Each face shows the card's rank and suit. A card block can also have a **material**, which changes how it scores (see [Scoring](#scoring)).
- **Modifier block:** a special block that changes play. Some modifier blocks work while held in the hand, and some once placed on the field.
- **Deck:** the player's collection of blocks. It starts as a standard 52-card deck and changes over a run. Since the deck can be modified, it may contain duplicate cards and cards a standard deck doesn't have.
- **Hand:** up to 5 blocks drawn from the deck.
- **Field:** the structure of blocks placed this round. It is built in an unbounded 3D grid of cells around a centre block.
- **Coins:** the currency, spent at the shop.

## A round

### Setup

1. The deck is shuffled and holds every block the player owns.
2. One block is drawn and placed as the **centre block**, which starts the field.
3. Five blocks are drawn into the hand.
4. The round shows its **target score**, its **play** count and its **discard** count (all _tune_).

### Turns

On each turn the player does one of the following:

- **Play:** drag one block from the hand onto an exposed face of any block on the field. The face's neighbouring cell must be empty. The block snaps into that cell and becomes part of the field. This uses one play, and then the field is [scored](#scoring).
- **Discard:** select blocks in the hand and discard them. This uses one discard and does not score. _(How many blocks one discard can remove is to be decided.)_

After either action, the hand is refilled to 5 blocks from the deck, or until the deck runs out.

A modifier block that works while held stays active as long as it is in the hand. Playing it ends that held effect, though it may have another effect once placed. So keeping a modifier in hand means giving up a hand slot.

### Winning and losing a round

- The round is **won** as soon as the running total reaches the target score, provided plays have not run out. The player then earns the round's coin reward.
- The round is **lost** if the last play is used and the running total is still short of the target. A lost round ends the run.

The field is cleared at the end of every round. Placed blocks return to the deck, and the next round starts from a new centre block.

## Scoring

### Running total

After every play, **every line on the field** is scored, and the sum is added to the round's running total. A line that already existed scores again on every later play. Lines built early therefore keep paying, which makes the order of placements a key decision.

### Lines

- A **line** is an unbroken run of **2 or more** blocks next to each other along one axis (X, Y or Z), with no gaps.
- A block with no neighbour along an axis is not part of a line on that axis and scores nothing there.
- Each block can be part of at most three lines, one per axis.
- A line of 2 to 5 blocks scores the best poker hand its cards make.
- A line of **6 or more** blocks scores the **best 5-card hand** found among its cards.
- If a line makes no better hand, it scores as **high card**.

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

The scoring formula is still being designed. It will have three parts:

1. **Base score:** each hand type has a base score, and this can be upgraded during a run.
2. **Materials:** each card in the scoring hand can have a material that changes the hand's score.
3. **Modifier blocks:** held or placed modifiers can change scoring and play.

## Coins

- Winning a round earns a fixed number of coins (_tune_).
- Some blocks have economic effects: certain plays earn coins.
- The player must balance building points against earning coins.

## A run

- Rounds come in **sets of three**. The **third round of each set is a boss round**, which adds extra rules or restrictions for more challenge.
- After each boss round there is a **shop**.
- Target scores rise as the run goes on (_tune_).
- A run is **won** by beating a fixed number of sets (_tune_). Losing any round ends the run.
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

1. **Scoring formula:** how base score, materials and modifiers combine (for example, additive and multiplicative parts, and their order).
2. **Applying upgrades and materials:** the shop sells only blocks, so how hand-type upgrades and card materials are gained or applied is still undecided.
3. **Material list:** which materials exist and what each one does.
4. **New hands:** the names, ranking and values of hands that need a modified deck.
5. **Discards:** how many blocks one discard can remove.
6. **Removal:** whether blocks can be destroyed or removed from the field, what happens to parts of the structure that end up disconnected, and whether a destroyed block also leaves the deck.
7. **Effect order on the field:** the fixed order in which line scores and block effects resolve (for example, placement order).
8. **Boss rules:** the list of boss restrictions and extra rules.
9. **Numbers to tune:** plays and discards per round, target scores, coin rewards, shop prices, and run length.
10. **Straights:** whether aces count both high and low, and whether a straight can wrap around (K-A-2).
11. **Naming:** the game's own name for modifier blocks.
