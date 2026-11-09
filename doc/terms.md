# Terms

Use these names consistently in code, documentation and player facing language.

| Term              | Meaning                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Game mode**     | A named playable configuration: available scenes, initial scene, mode-wide rules and save identity. In code: `GameMode`. The developer variants are modes, not rooms.                                        |
| **Scene**         | A presentation context such as title, stage, shop, settings, stage-won or game-over. A scene has an id and trait data. In code: `Scene`.                                                                     |
| **Scene stack**   | The active scene layers managed at runtime. Push a temporary menu or result panel over the current scene, then pop it to resume what was underneath. Replace the stack when changing to an unrelated screen. |
| **Scene graph**   | In common game engine usage, a hierarchy of scene objects/nodes. This project’s `GameMode.scenes` is a catalogue of scene definitions, not a scene graph.                                                    |
| **Game flow**     | The rules that choose the next scene after actions or outcomes. The run controller currently coordinates this flow; the mode’s scene list and `startScene` do not yet define all transitions.                |
| **Trait**         | Reusable behavior configured as data and attached to a scene, mode or block. Scene traits receive lifecycle hooks from the scene manager.                                                                    |
| **Game run**      | One playthrough’s live rules state: deck, hand, field, score, coins, passives and phase. In code: `GameRun`. It survives scene changes and can produce a save snapshot.                                      |
| **Run rules**     | The progression and economy rules used to create a game run. In code: `RunRules`.                                                                                                                            |
| **Round**         | Three stages in order: stage 1, stage 2 and boss, each followed by a shop.                                                                                                                                   |
| **Stage**         | One attempt at a score target, with its own plays and discards and an empty field at the start.                                                                                                              |
| **Boss stage**    | The third stage of a round. It can use a different registered dealer with extra rules.                                                                                                                       |
| **Phase**         | The run's current step: `stage-1`, `stage-2`, `boss`, `shop` or `over` after a loss. In code: `GameRun.phase`.                                                                                               |
| **Shop**          | A between-stage scene where the player may buy upgrades. The game run remains alive while the shop scene is shown.                                                                                           |
| **Dealer**        | A registered rule set that deals, judges plays and discards, and scores a stage.                                                                                                                             |
| **Field**         | The blocks placed this stage, each in a grid cell.                                                                                                                                                           |
| **Centre block**  | The first block played in a stage, placed at the centre of the empty field.                                                                                                                                  |
| **Hand**          | Up to five blocks the player can play or discard.                                                                                                                                                            |
| **Deck**          | Blocks the player owns that are not on the field, in hand or in the discard pile.                                                                                                                            |
| **Discard pile**  | Discarded blocks. It persists across stages of a round.                                                                                                                                                      |
| **Play**          | Moving one block from the hand onto the field. Each stage allows a fixed number.                                                                                                                             |
| **Discard**       | Moving one block from the hand to the discard pile. Each stage allows a fixed number.                                                                                                                        |
| **Line**          | A maximal gap-free run of two or more placed blocks along one axis. Every line scores after every play.                                                                                                      |
| **Running total** | The score of the current stage.                                                                                                                                                                              |
| **Challenge**     | Reserved for a future feature; not a synonym for stage or round.                                                                                                                                             |
| **Passive block** | A block with configured traits that can be installed in the passive rack and respond to gameplay events.                                                                                                     |
| **Passive rack**  | The ordered zone for installed passive blocks, separate from the hand and field. By default, passives resolve from left to right.                                                                            |
| **Title screen**  | The opening screen with Continue, New game and Settings.                                                                                                                                                     |
| **Save**          | A persisted snapshot produced by `GameRun.snapshot()` and stored by `save.ts` through the run controller. A lost run has no save.                                                                            |
| **Continue**      | Restore a saved snapshot as a live game run.                                                                                                                                                                 |
| **Settings**      | Player preferences such as audio and motion options, stored separately from the run save.                                                                                                                    |
| **Reorder**       | Moving a block to another position within an ordered zone. It does not consume a play or discard.                                                                                                            |

## How the concepts relate

```text
GameMode ── describes available Scene definitions and mode-wide configuration
                    │
                    └── Game flow chooses which Scene to show

SceneManager ── owns the active Scene stack
                    ├── push Settings or StageWon over the current scene
                    ├── pop them to resume the scene underneath
                    └── replace the stack for Title or GameOver

GameRun ── owns one playthrough and survives scene changes
RunRules ── supplies progression/economy rules to a new GameRun
Traits ── add reusable behavior to scenes, modes and blocks
```

For example, the main game **flow** routes a stage win to the stage-won presentation, then to the shop, then to the next stage. A loss routes to game-over. The current game has repeated rounds rather than a terminal run victory, so stage-won is a per-stage result; a finite mode can add a run-won destination to its flow.

The title-to-game transition replaces the title stack with the first stage. During play, Escape **pushes** Settings above that stage; closing Settings **pops** it and reveals the same stage and `GameRun` underneath. The stage-won result is also pushed while its reward sequence plays. The shop is a scene between stages; the run persists through it. Title and game-over currently replace the stack.

When a scene becomes active, `SceneManager` calls each attached trait's `enter(context, config)` hook. When a scene is removed, it calls its traits' `exit(context, config)` hooks. Pushing Settings enters Settings traits but leaves the covered stage entered; popping Settings exits its traits and resumes the stage without calling the stage's enter hook again. Replacing the stack exits removed scenes and enters the replacement. This is how scene-owned behaviors can start and stop in step with stack changes.

Mode-wide configuration and scene traits are distinct attachment scopes. Current mode traits configure run creation, save identity and available game features; they are not automatically inherited by each scene. Music policy is currently the `GameMode.musicStyle` property, pending its move to a composed trait. Scene traits describe behavior composed on a particular scene. If a mode should provide defaults to scenes, that composition should be explicit in the mode/scene model.
