# Game architecture notes

Status: core principles agreed; the current drag-and-attach demo implements the initial spatial rules and the trait container. The general trait event/effect design is still open.

## Game concept

Poker Blocks will be a puzzle game in the style of poker solitaire. Its main source of interest should be the unexpected ways players can combine reusable game features.

A basic block represents one of the 52 cards in a standard deck. An `identifiable` trait holds its rank and suit and answers shared identity queries. Every geometric face of its cube shows that same identity; geometric faces are distinct from behavior traits. The identity model should later admit special cards unique to this game.

The deck is the collection of cards currently possessed. At the start of this game's demo, one card is drawn for the large center block and five other cards are drawn into the hand. The hand is a list of five cards. All six draws are distinct, leaving 46 cards in the deck. The five hand blocks are one-third the size of the center block and appear in a row at the bottom of the screen. Reloading deals a new set.

This five-card starting hand is a rule for Poker Blocks. [Traditional Poker Squares](https://www.cs.gettysburg.edu/~tneller/games/pokersquares/index.html), often called poker solitaire, instead draws one card at a time into a 5×5 grid.

## Agreed principles

- Composability takes priority when designing game mechanics.
- A block is defined by data and configured trait instances. Block types do not own behavior code.
- Behavior code lives in reusable traits. Each trait instance carries configuration for its block.
- The game engine should run traits through shared rules and events. It should not branch on specific block types or implement one-off block behavior.
- The same trait can be attached to multiple block definitions with different configurations, and multiple traits can be attached to one block.

## Examples

- `additiveScore` has a numeric amount configured per block, such as `+5`.
- `scorable` supplies a block's base numeric score as trait configuration. Standard cards use 2–10 as printed, J = 11, Q = 12, K = 13 and A = 14. Hand recognition reads card identity; line scoring reads the scorable value of each contributing block. Future blocks can configure a different value without adding a scoring branch for their type.
- `identifiable` supplies rank and suit and reusable queries such as `isFaceCard()`, `isNumberCard()`, and `hasSuit(suit)`. Standard cards derive these answers from one identity configuration rather than storing duplicate flags: J/Q/K are face cards, 2–10 are number cards, and Ace is neither category. Special card identities can extend the same query vocabulary.
- `explosive` destroys its block and adjacent blocks; its configured scalar controls the strength or reach. The exact meaning of that scalar is undecided.

These names and payloads are examples, not a frozen API.

## Core runtime

Four small modules under `src/core/` carry the trait pattern. They are independent of cards and of rendering, and none of them knows about a specific trait.

`registry.ts` is a named collection of definitions with unique names. `register` throws on a duplicate name and `get` throws on an unknown one, so a double import or a misspelled reference fails loudly rather than silently overwriting or returning nothing. It holds no gameplay meaning of its own; it is the lookup that lets definitions stay plain data while behavior lives elsewhere.

`emitter.ts` is a minimal named-event channel with `on`, `emit`, `listens`, and `clear`. Every dispatch iterates a snapshot of the listener set, so a listener may subscribe or unsubscribe during a dispatch without disturbing it.

`trait.ts` defines what a trait is. `defineTrait` takes a name, default settings, an optional `setup`, and an optional per-frame `update`, and returns the definition. `trait(def, settings)` builds a type-checked settings override for one attachment.

`block.ts` is the container. A block holds an id, a map of attached traits, and an event channel. It has no gameplay code of its own: `add` merges the override over the trait's defaults and runs `setup`, `remove` runs the attachment's cleanup, and `update` ticks every attached trait each frame.

## Trait configuration pattern

A trait is a reusable behavior plus the configuration that makes it concrete. A block is a list of configured trait entries, and no block type carries behavior code.

The configuration has three properties that the container enforces:

1. Settings are merged over `structuredClone(defaults)`, so every attachment owns its settings object and mutating one block's configuration cannot affect another block using the same trait.
2. `setup` may return a cleanup function, or a `TraitInstance` with its own `update` and `dispose`. Per-attachment runtime state closes over the trait's own locals, so it needs no `WeakMap` and no field reserved on the block.
3. Settings must stay plain, serializable data. This is what lets a block's configuration be inspected, compared, and eventually saved. Behavior belongs in the trait definition, not in a function stored in settings.

Traits are referenced by their definition object, not by a name string, so `add`, `has`, and `settingsOf` are fully typed and a missing trait is a compile error rather than a runtime lookup. Named data that definitions refer to each other by, such as an effect id, goes through `Registry` instead. Keeping the two mechanisms separate is deliberate: direct references get type checking, and string ids get data that can be authored and serialized.

Traits are detached in reverse order of attachment when a block is disposed, so a trait may rely on anything it was attached after.

The demo's pure helpers separate behavior from container wiring. `toggleBlockSelection`, `attachmentCell`, `faceFromNormal`, and `inspectBlock` are plain functions over plain state, and the trait wrapping one calls it rather than reimplementing it. This keeps a trait's rules testable without constructing a block, a scene, or a renderer.

### Traits whose settings hold a function

`inspectable` currently stores a closure, `inspectable(description)` returning `{ inspect }`. That fits the present struct-shaped block type but conflicts with the rule that settings stay serializable. When the trait is ported, the description becomes the trait's `defaults`, and the invocation belongs to the trait definition or to a trait-level function, not to per-block settings. Future traits should not store closures in `defaults`.

## Selectable trait

A block with the `selectable` trait can respond to a player click or tap. The trait toggles that block's selected state; selecting one block does not clear other selections. Clicking the same block again unselects it. Selection marks cards the player intends to operate on, whether they are in the hand or the large center area. Selection is separate from identity: the card remains the same rank and suit. The toggle behavior belongs to the trait, not to a particular card or block type.

The current visual cue is face illumination only. Selection does not change a block's size or position, so connected cubes remain aligned. True bloom remains an option if a softer glow is wanted later.

What an operation does to the selected cards is still to be decided.

## Inspectable trait

An inspectable trait instance implements `inspect(): string`. The hover UI calls that method and displays its result beside the pointer for a block in the hand or in play. Standard cards configure the trait with their rank and suit name. Future block types can provide their own description through the same trait, with no tooltip behavior on the block itself.

## Attachable trait and dealer

The `attachable` trait lists the faces of a block that may accept another block: `north`, `south`, `east`, `west`, `up`, and `down`. Standard cards allow all six. A face can accept a dragged hand block only when its neighboring grid cell is empty. The block snaps face-to-face into that cell, leaves the hand, and becomes part of the structure. Any exposed face of any placed block can be used; dragging the structure reveals its other sides.

The dealer is a rule system, rather than a block. After a successful attachment it draws from the remaining deck until the hand contains five cards, or the deck is empty. The six starting cards and all subsequent draws remain unique.

When dragging a hand block starts, the structure's wobble slows to one-tenth of normal over half a second. On drop or cancel it eases back over half a second. Small numeric easing helpers live in `src/easing.ts` for later animations.

The hand is rendered as a fixed overlay with its own camera. Only the structure uses the perspective board camera. After a block attaches, the board camera waits one second, then eases over two seconds to a distance calculated from the grid's bounding box, so the growing structure stays visible. The hand's size and position do not follow that camera move.

All standard cubes currently have equal mass. The structure keeps a running sum of block grid positions and divides by the block count to find its true center of gravity after each attachment. The rotation pivot moves to that center while preserving the existing block positions. The structure gently oscillates on two axes around the pivot instead of spinning continuously. Dragging any placed block rotates the structure on horizontal and vertical axes; the oscillation continues around the new orientation. A click without dragging still toggles selection.

## Stage overlay and discard area

Each stage starts at score 0 with the target, plays and discards from the session configuration. A successful attachment consumes one play and scores the field. Dropping a hand card into the fixed two-dimensional discard area, marked by a pixel art bin, adds it to the discard pile and consumes one discard. The dealer refills the hand after either action. Invalid drops consume nothing.

The deck count appears at the lower right. The counters and discard area stay fixed on screen while the board camera moves.

## Game state and dealer

`GameState` is the single source of truth for the field, hand, deck, discard pile, and round counters. Each zone holds the actual card blocks, not a count of them. The field pairs each block with its grid cell. The UI's Three.js objects, animations, and selection highlights remain presentation state outside `GameState`.

The canonical domain terms are in [terms.md](terms.md): a **stage** is one score-target game and a **round** contains three stages ending in a boss stage and shop. Within a round, the deck and discard pile persist across stages, while the dealer resets the field and sets fresh play and discard allowances for each stage. Cards discarded in an earlier stage stay unavailable in later stages of that round.

The stage opens with an empty field and a dealer-filled hand. The player may discard before placing anything. The first play is a drag from the hand into the empty field, creating the centre block and consuming one play.

`GameSession` owns progression through stage one, stage two, boss stage, shop, and the next round. It selects the active dealer and target score for each stage, asks that dealer to set the stage's field and allowances, and carries the deck and discard pile across the three stages. Its snapshot includes the current round and phase for a future save/Continue flow.

A registered dealer reads `GameState` to decide whether a move is legal and returns the next state after a play or discard. The base dealer owns the current five-card hand, six plays, four discards, provisional target score of 100, opening deal, face attachment rules, and hand refill. `GameSession` holds the active dealer and current state; switching to another registered dealer preserves the exact state value. A future boss dealer can change rule methods without moving cards between zones or adding boss checks to the scene.

## Placement and card appearance

After a hand cube is dropped on an attachable face, its screen position is mapped through the board camera into the play scene. The same cube becomes a child of the rotating assembly and moves, turns, and grows toward the target cell in assembly-local coordinates over one second using the shared easing helper. Because the cube and target share a parent, the destination follows the board's wobble throughout the flight. Its hand slot remains empty during that second. The dealer refills that slot when the placement finishes, and the new cube materializes with a Perlin noise shader adapted from `../shrew_farmer/src/hud/materialise.ts`.

A discarded hand cube dissolves with the same shader over one second before its slot refills. The discard effect runs backwards from the appearance effect. Other hand cubes stay in their slots during either animation. Reduced-motion settings shorten the effect and use a fade.

## Field visual effects (proposal)

Field visual effects are presentation behaviors, separate from gameplay effects such as adding score or destroying blocks. The current `tintRow` effect temporarily colors a scoring line gold. A future field effect registry could resolve named requests with target block IDs and visual parameters such as color, intensity, duration, and easing. The same mechanism could later draw glows, bursts, or explosions for unrelated game events.

Gameplay resolves first. A presentation coordinator may turn the resulting events into field visual effect requests, but the visuals never determine score or mutate `GameState`. An explosive trait, for example, would use gameplay effects to remove blocks and a separate field effect request to show an explosion. Multiple temporary effects and persistent selection illumination need a defined visual composition policy so one highlight does not erase another; that policy is still open.

After each play, scoring calculates all line scores first, filters out zero-point lines, and orders the remainder from lowest to highest. Presentation then steps through that ordered result, tinting each row gold and playing a `score.magnitude.*` sound chosen for its points. The scorer does not call shaders or audio directly.

## Passive registry and triggers (design)

The proposed event order, reaction contract, and effect boundaries are specified in [game-events.md](game-events.md). The current game has only a general event emitter; it does not implement that gameplay contract yet.

Passive definitions live in a named registry with a stable id, display name, visual design or icon, configured trait references, and optional visual effect ids. The passive itself is a block instance in a passive-rack zone of future `GameState`. Behavior code belongs to reusable traits, not the block instance or an ad hoc function attached to one registry entry. A trait may listen for gameplay events such as block placement, apply a condition, produce a gameplay effect such as coins proportional to the placed card's rank, and request separate presentation effects.

Passives may react throughout the stage or session, not only during scoring. The engine should expose named lifecycle events with explicit timing and context: for example, before the first play in a stage, before/after a block is placed, before/after one line is scored, after all lines are scored, and when a stage is won or lost. These are examples, not an exhaustive event list. A passive's trait checks its configured condition against the event and returns gameplay effects; an event may also lead to separate sound or visual requests. This gives designers callback-like trigger points without storing arbitrary callback code on individual blocks.

Timing matters: a trait that changes a block's base value or a line's points must run at a defined pre-score point, while a reaction to a finalized `lineScored` event sees the completed result. An `allLinesScored` reaction sees the aggregate after the line pass. Victory and loss reactions need an explicit place relative to the dealer's outcome check. The pure line scorer remains free of lifecycle dispatch; a coordinator invokes it within the larger event/effect sequence. The exact event vocabulary and resolution rules are still to be specified.

Trigger usage is configurable per passive: unlimited, a fixed count, or one-shot. Remaining uses are instance state; exhausting them can destroy the passive. Passives are not discardable. A separate sell interaction can remove an installed passive at any time and award coins without using a stage discard. The rack size, sale values, and installation flow remain open.

The proposed hand and passive rack are ordered zones in `GameState`. A generic reorder action would change item order when a block is dragged between slots in its own zone; it would not consume a play or discard. For passives responding to the same trigger, the default resolver would use a snapshot of rack order and apply their gameplay effects left to right. An explicitly defined timing rule could override that default. The renderer would reflect the new order but would not decide effect order itself.

## Line scoring

`src/scoring.ts` holds pure scoring primitives with no UI, sound or state changes. `findScoringLines` returns every maximal gap-free run of two or more placed blocks along X, then Y, then Z, with its cells and blocks in cell order. `scoreLine` returns one line's numeric score, and `evaluateLine` adds the hand type and the ids of the cards that counted. Card points come from the configured `scorable` trait (`src/traits/scorable.ts`), never from the block type. `scoreField` scores every line, and `presentationOrder` drops zero-point lines and sorts the rest lowest first.

After each successful play the base dealer adds the points of every line on the field to the running total. `roundOutcome` reports the stage as won once the total reaches the target and lost when plays run out short of it; the dealer then refuses further plays and discards. The formula and its provisional edge rules are in `doc/game.md`.

When the placed card lands, the scene presents each scoring line from lowest to highest: the reusable `tintRow` effect flashes its blocks gold, the `score.magnitude.*` sound for its points plays (`src/score-presentation.ts`), and its points are added to the displayed score. The stage result and its sound follow the last line.

## Session controller

`GameSession` (`src/game-session.ts`) controls one run: stage 1 → stage 2 → boss stage → shop → next round. It holds the round number, the phase (a stage, `shop` or `over`), the active dealer and the current `GameState`. `advance()` moves on once the current stage is decided: a win starts the next stage, or opens the shop after the boss stage, and a loss sets the phase to `over`. `leaveShop()` starts stage 1 of the next round. `snapshot()` returns the round, phase, dealer name and state for a future save/Continue flow.

Each stage's dealer, target, plays and discards come from a `SessionConfig` (`src/session-config.ts`), not from the scene. The config also names the open rules as explicit options: what happens to the hand at a stage boundary, and whether the discard pile returns to the deck after the shop. `demoSessionConfig` holds the documented placeholders.

A dealer's `startStage` returns the field to the deck, sets the stage's counters and fills the hand. The field starts empty, and the first play needs no target: `placementFor` returns the centre cell when the field is empty. In the scene, dropping a hand block anywhere above the hand on an empty field plays it at the centre. When a stage is decided, a button in the round panel offers the next step (next stage, shop, next round or a new game), and taking it clears the table and deals the new hand.

## Ordered zones and hand reordering

`GameState.hand` is the source of truth for hand order; the scene's hand slots always follow it (`syncHandSlots`). `src/zones.ts` provides `moveItem` and `insertAt` for any ordered zone, so the future passive rack can reuse them. `GameSession.reorderHand(from, to)` moves a card without changing counters, score or any other zone, and `refillHand(slot)` puts a drawn card in the gap left by the card just played or discarded.

In the scene, a dragged hand card that is over the hand area (the bottom of the screen, where neither a field face nor the discard area applies) previews its new position: the other cards glide aside. Dropping there reorders the hand, plays `hand.reorder` and autosaves; dropping on a field face or the discard area still plays or discards. The passive rack itself, and resolving passives in rack order, wait for the passive implementation (issue #4).

## Card room and shadows

`src/visual/card-room.ts` sets the board scene in a dim card room: a procedurally drawn backdrop (warm panelled walls, lamp glow, vignette) and a round green baize table with a wooden rim. No image assets are used. The table is fixed in the world rather than in the rotating pivot; each frame it eases to sit just below the structure's bounding sphere and grows with it, so the structure can still turn freely above it. An overhead lamp (a directional light above and slightly in front) casts soft PCF shadows onto the baize and between cubes. Its shadow camera is re-fitted around the structure as it grows. The hand keeps its own neutral light in a separate scene and stays a fixed overlay.

The **Shadows** setting chooses high (2048 px shadow map), low (1024 px) or off; automatic picks low on touch-first devices and high elsewhere. Changing it rebuilds materials, since shadow support is compiled into them.

## Title, settings and saving

The page opens on a title screen (`src/menus.ts`) over the empty table. **Continue** appears only when a valid saved run exists and resumes it exactly; **New game** asks for confirmation first if it would replace a save; **Settings** opens the settings screen. A settings button at the top of the game screen (or Escape) opens the same screen during play, and Back returns to wherever it was opened from. When a run is lost, the HUD's "New game" returns to the title screen. The screens are DOM overlays that cover the scene, so the board takes no input while one is open.

Settings (`src/settings.ts`) are sound volume, mute, motion (follow system, reduced or full) and shadows (automatic, high, low or off). They apply immediately and persist in `localStorage` under `poker-blocks.settings`; invalid stored values fall back to defaults field by field.

The run is saved automatically (`src/save.ts`) at safe points only: when a placement or discard has finished resolving, after a stage transition, and when a run starts or resumes. The record is versioned and stores card ids rather than `CardBlock` objects, because some traits hold functions and the deck definition is the source of truth:

```json
{
  "version": 1,
  "round": 1,
  "phase": "stage-2",
  "dealer": "base",
  "state": {
    "field": [{ "cardId": "7-hearts", "cell": { "x": 0, "y": 0, "z": 0 } }],
    "hand": ["K-spades"],
    "deck": ["..."],
    "discardPile": ["..."],
    "round": { "score": 0, "targetScore": 150, "movesLeft": 6, "discardsLeft": 4 }
  }
}
```

Loading rebuilds the blocks from the standard deck and `GameSession.fromSnapshot` restores the session. A record with another version, an unknown phase or dealer, unknown or duplicate card ids, a missing card or malformed numbers is ignored, which hides Continue. A lost run (phase `over`) clears the save. All storage access is wrapped so the game still works, without Continue or remembered settings, when storage is unavailable.

## Architecture to discuss

Settled: the data-only block definition, the trait container, the named registry, and the event channel described above. The demo's existing traits are still plain fields on a `CardBlock` struct and have not been ported onto the container yet; that port is what makes new traits like `additiveScore` and `explosive` a file each with no engine change.

Still open: the effect engine. A trait receives an event and a limited view of game state, then returns effects such as `addScore` or `destroyBlock`. The engine applies those effects in a defined order and emits any resulting events. Rendering reads game state separately.

This keeps behavior reusable, but the event and effect rules need deliberate design. Before implementing them, decide:

1. Which events traits can react to, and whether a trait can react to effects it caused.
2. How to order multiple traits and resolve simultaneous effects.
3. How chain reactions terminate and how to prevent accidental infinite loops.
4. What `explosive` strength means: radius, damage, number of targets, or something else.
5. How poker-hand scoring and spatial rules fit into the same composition model.
6. Whether a trait's `update` may mutate block state that another trait reads in the same frame, or whether changes must go through the event channel.
7. How to migrate the demo's current data-only `identity` field to the agreed `identifiable` trait without duplicating rank and suit state.
