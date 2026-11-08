# Game architecture notes

Status: principles agreed in conversation; implementation design still open.

## Game concept

Poker Blocks will be a puzzle game in the style of poker solitaire. Its main source of interest should be the unexpected ways players can combine reusable game features.

A basic block represents one of the 52 cards in a standard deck. An identity trait holds its rank and suit. Every geometric face of its cube shows that same identity; geometric faces are distinct from behavior traits. The identity model should later admit special cards unique to this game.

The deck is the collection of cards currently possessed. At the start of this game's demo, one card is drawn for the large center block and five other cards are drawn into the hand. The hand is a list of five cards. All six draws are distinct, leaving 46 cards in the deck. The five hand blocks are one-third the size of the center block and appear in a row at the top of the screen. Reloading deals a new set.

This five-card starting hand is a rule for Poker Blocks. [Traditional Poker Squares](https://www.cs.gettysburg.edu/~tneller/games/pokersquares/index.html), often called poker solitaire, instead draws one card at a time into a 5×5 grid.

## Agreed principles

- Composability takes priority when designing game mechanics.
- A block is defined by data and configured trait instances. Block types do not own behavior code.
- Behavior code lives in reusable traits. Each trait instance carries configuration for its block.
- The game engine should run traits through shared rules and events. It should not branch on specific block types or implement one-off block behavior.
- The same trait can be attached to multiple block definitions with different configurations, and multiple traits can be attached to one block.

## Examples

- `additiveScore` has a numeric amount configured per block, such as `+5`.
- `explosive` destroys its block and adjacent blocks; its configured scalar controls the strength or reach. The exact meaning of that scalar is undecided.

These names and payloads are examples, not a frozen API.

## Selectable trait

A block with the `selectable` trait can respond to a player click or tap. The trait toggles that block's selected state; selecting one block does not clear other selections. Clicking the same block again unselects it. Selection marks cards the player intends to operate on, whether they are in the hand or the large center area. Selection is separate from identity: the card remains the same rank and suit. The toggle behavior belongs to the trait, not to a particular card or block type.

The initial visual cue is a bright edge, slight lift, modest face brightening, and a small increase in scale. The hand and center blocks can use different strengths for these cues. True bloom remains an option if a softer glow is wanted later.

What an operation does to the selected cards is still to be decided.

## Architecture to discuss

A possible shape is a data-only block definition, a registry of trait implementations, and a small event/effect engine. A trait receives an event and a limited view of game state, then returns effects such as `addScore` or `destroyBlock`. The engine applies those effects in a defined order and emits any resulting events. Rendering reads game state separately.

This keeps behavior reusable, but the event and effect rules need deliberate design. Before implementing them, decide:

1. Which events traits can react to, and whether a trait can react to effects it caused.
2. How to order multiple traits and resolve simultaneous effects.
3. How chain reactions terminate and how to prevent accidental infinite loops.
4. What `explosive` strength means: radius, damage, number of targets, or something else.
5. How poker-hand scoring and spatial rules fit into the same composition model.
