# Terms

Canonical names used in the rules, the code and the docs. Use these words and no others for the same idea.

| Term              | Meaning                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Run**           | One whole game attempt, from the first stage until a stage is lost or the run is won. In code: a `GameSession`.                                      |
| **Round**         | Three stages in order: stage 1, stage 2 and the boss stage, each followed by a shop. Rounds are numbered from 1.                                     |
| **Stage**         | One attempt at a score target, with its own plays and discards and an empty field at the start. In code: `StageKind` (`stage-1`, `stage-2`, `boss`). |
| **Boss stage**    | The third stage of a round. It can use a different registered dealer with extra rules.                                                               |
| **Phase**         | Where the session is now: one of the three stages, `shop`, or `over` after a loss.                                                                   |
| **Shop**          | A skippable buying screen after each completed stage. Leaving the boss-stage shop starts the next round.                                             |
| **Dealer**        | A registered rule set that reads and changes `GameState`: it deals, judges plays and discards, and scores. Each stage names its dealer.              |
| **Field**         | The blocks placed this stage, each in a grid cell.                                                                                                   |
| **Centre block**  | The first block played in a stage, placed at the centre of the empty field.                                                                          |
| **Hand**          | Up to five blocks the player can play or discard.                                                                                                    |
| **Deck**          | The blocks the player owns that are not on the field, in the hand or in the discard pile.                                                            |
| **Discard pile**  | Discarded blocks. It persists across the stages of a round.                                                                                          |
| **Play**          | Moving one block from the hand onto the field. Each stage allows a fixed number.                                                                     |
| **Discard**       | Moving one block from the hand to the discard pile. Each stage allows a fixed number.                                                                |
| **Line**          | A maximal gap-free run of two or more placed blocks along one axis. Every line scores after every play.                                              |
| **Running total** | The score of the current stage.                                                                                                                      |
| **Challenge**     | Reserved for a future feature; not a synonym for stage or round.                                                                                     |
| **Passive block** | A block with configured traits that can be installed in the passive rack and respond to gameplay events.                                             |
| **Passive rack**  | The ordered zone for installed passive blocks, separate from the hand and field. By default, passives resolve from left to right.                    |
| **Title screen**  | The screen shown when the page opens, with Continue, New game and Settings.                                                                          |
| **Save**          | The one stored run, written automatically at safe points. A lost run has no save.                                                                    |
| **Continue**      | Resume the saved run exactly where it was.                                                                                                           |
| **Settings**      | Player preferences (sound volume, mute, motion), stored separately from the save.                                                                    |
| **Reorder**       | Moving a block to another position within an ordered zone (the hand, later the passive rack). Not a play or discard.                                 |
