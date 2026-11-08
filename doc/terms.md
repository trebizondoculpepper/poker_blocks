# Game terms

This is the single source for the names of the game's time scales and related play areas. The rules that use them are in [game.md](game.md).

- **Session (run):** one complete attempt, including its progress through rounds, stages and shops, its evolving collection of blocks, and any saved progress. Losing a stage ends the session. The number of rounds needed to win is still to be set.
- **Session controller:** the planned coordinator that advances a session through stage one, stage two, boss stage, shop, then the next round. It selects the dealer and score target for each stage and preserves the appropriate game state between them.
- **Round:** three stages played in order, followed by a shop after the third stage. The deck and discard pile carry across all three stages.
- **Stage:** one score-target game. The field starts empty, the dealer sets fresh play and discard allowances, and the player can play or discard from the hand. The first play places the centre block. Stage one has a lower score target than stage two.
- **Boss stage:** stage three of a round. Its dealer may change the rules or restrict play; its exact score target is still to be designed.
- **Challenge:** a separate, later feature that adds a special objective or restriction, such as winning without playing Hearts or with all fives debuffed. It is not another name for a stage.
- **Field:** the blocks placed in the current stage. It resets between stages.
- **Discard pile:** blocks discarded during the current round. They remain unavailable in later stages of that round. Whether they return to the deck after the shop remains open.
- **Passive block:** a block with configured traits that can be installed in the passive rack and respond to gameplay events. It may have a limited number of triggers. It is sold through a separate sell target rather than discarded.
- **Passive rack:** the ordered installed passive blocks at the top of the screen, separate from the hand and field. By default, passives triggered together resolve from left to right.
