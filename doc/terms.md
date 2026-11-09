# Terms

Use these names consistently in code, documentation and player facing language.

| Term                             | Meaning                                                                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Game mode**                    | A named playable configuration: available scenes, initial scene, mode-wide rules and save identity. In code: `GameMode`. The developer variants are modes, not rooms.                                        |
| **Scene**                        | A presentation context such as title, stage, shop, settings, stage-won or game-over. A scene has an id and trait data. In code: `Scene`.                                                                     |
| **Scene stack**                  | The active scene layers managed at runtime. Push a temporary menu or result panel over the current scene, then pop it to resume what was underneath. Replace the stack when changing to an unrelated screen. |
| **Scene graph**                  | In common game engine usage, a hierarchy of scene objects/nodes. This project’s `GameMode.scenes` is a catalogue of scene definitions, not a scene graph.                                                    |
| **Game flow**                    | The rules that choose the next scene after actions or outcomes. The run controller currently coordinates this flow; the mode’s scene list and `startScene` do not yet define all transitions.                |
| **Trait**                        | Reusable behavior configured as data and attached to a scene, mode or block. Scene traits receive lifecycle hooks from the scene manager.                                                                    |
| **Game run**                     | One playthrough’s mutable rules state: deck, hand, field, score, coins, passives, phase and save snapshot. In code: `GameRun`. It can persist while the scene stack changes.                                 |
| **Run rules**                    | The progression and economy rules used to create a game run. In code: `RunRules`.                                                                                                                            |
| **Round**                        | Three stages in order: stage 1, stage 2 and boss, each followed by a shop.                                                                                                                                   |
| **Stage**                        | One attempt at a score target, with its own plays and discards and an empty field at the start.                                                                                                              |
| **Shop**                         | A between-stage scene where the player may buy upgrades. The game run remains alive while the shop scene is shown.                                                                                           |
| **Dealer**                       | A registered rule set that deals, judges plays and discards, and scores a stage.                                                                                                                             |
| **Field**                        | The blocks placed this stage, each in a grid cell.                                                                                                                                                           |
| **Hand**                         | Up to five blocks the player can play or discard.                                                                                                                                                            |
| **Deck**                         | Blocks the player owns that are not on the field, in hand or in the discard pile.                                                                                                                            |
| **Discard pile**                 | Discarded blocks. It persists across stages of a round.                                                                                                                                                      |
| **Passive block / passive rack** | A block with gameplay traits / the ordered zone holding installed passive blocks.                                                                                                                            |
| **Save / Continue**              | The persisted snapshot of a game run / resuming that run from its snapshot.                                                                                                                                  |

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

The Escape/settings menu is a scene pushed over the active game scene. Dismissing it pops the menu and reveals the same underlying scene. The stage-won result is also pushed while its reward sequence plays. The shop is a scene between stages; the `GameRun` remains the same run and enters its shop phase. Title and game-over screens currently replace the stack. A future win ending can use its own scene in the same way.

Mode-wide configuration and scene traits are distinct attachment scopes. Current mode traits configure run creation, save identity, music policy and available game features; they are not automatically inherited by each scene. Scene traits describe behavior composed on a particular scene. If a mode should provide defaults to scenes, that composition should be explicit in the mode/scene model.
