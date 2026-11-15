# Full gamepad control: evidence and a proposal for discussion (#1331)

Research only. The owner asked for a source-backed proposal for full gamepad control, **not** an implementation. **Nothing here is approved design.** The agreed scheme goes into a design PR, and focused implementation tickets follow only after that. No runtime code, dependency or prototype is part of this change.

Source audit at `a76d242` (main, 2026-11-15). In the evidence sections, "verified" means read in the code and "inferred" means not traced end to end.

## 1. What a player does today, and who owns it (evidence)

All table play is pointer-only. The **model and rules calls underneath it are already callable without a pointer**; what is missing is the presentation-side path that chooses a target without a hit test.

| Action                                       | Owner                                                                                                                                     | Input today                                                                                        | Non-pointer entry today                                                                                                       | Legality decided by                                                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Rotate the field (view only)                 | `cameraView.rotateBy(dx, dy)`, `src/camera-view.ts:217`, called from `src/table-input.ts:778,799`                                         | Drag empty board; two-finger twist (use-gesture, `bindBoardGestures` `src/table-input.ts:741-818`) | Yes: `rotateBy` takes pixel deltas (0.005 rad/px)                                                                             | None. Rotation is view-only (inferred: no model reads of camera angle), but it decides which face a pointer raycast reaches |
| Zoom                                         | `setZoom`, `zoomWithWheel`, `zoomWithPinch`, `src/camera-view.ts:205-213`                                                                 | Wheel, pinch                                                                                       | Yes: `setZoom(zoom)`                                                                                                          | None                                                                                                                        |
| Select / deselect cards (single or multiple) | `toggleBlockSelection` via `onClick`, `src/table-input.ts:917-928`; selection is a private `Set`                                          | Click or tap under dnd-kit's 8 px drag threshold                                                   | Partial: `deselect(ids)` and `clearSelection()` exist (`:1127-1133`), **no `select(id)`**, no hand focus index                | The block's `selectable` trait                                                                                              |
| Choose the attachment face/cell              | `pickAttachment` `src/table-input.ts:472-488` → `field.faceAt(raycaster)` `src/field-view.ts:293-304`                                     | Pointer raycast only                                                                               | **No**: `rules.linePlacement(count, targetId, face)` validates one face but nothing enumerates the legal ones                 | Grid `canDrop` = `rules.canPlay()` and a non-null `linePlacement` (`src/table-input.ts:276-279`)                            |
| Preview the placement                        | `field.showCandidate(candidate)` `src/table-input.ts:280-286`                                                                             | During a drag                                                                                      | Yes: takes a `Candidate`                                                                                                      | n/a                                                                                                                         |
| Commit the placement                         | Grid `drop` → `rules.play(carried, gridCandidate)` → `presenter.play`; settled through `settleHandRelease` (`src/table-input.ts:571-593`) | Drop                                                                                               | Model: yes (`play` codec, `src/command-codecs.ts:51`, `PlayAction`); presentation needs the rendered blocks and a `Candidate` | Dealer and `GameRun`                                                                                                        |
| Cancel                                       | `cancelDrag` `src/table-input.ts:596`; `cancelGestures()`                                                                                 | Release off target, blur, Escape through `pausesBelow`                                             | Yes: `cancelGestures()`                                                                                                       | n/a                                                                                                                         |
| Discard                                      | Drop on the discard target (`src/table-input.ts:250-268`), or `onDiscardClick` (`:949-962`)                                               | Drag to the bin, or click it                                                                       | Yes: the click path takes no coordinates; `discard` codec                                                                     | `rules.canDiscard`                                                                                                          |
| Reorder hand                                 | `hand` drop target (`src/table-input.ts:303-326`) → `rules.reorderHand`                                                                   | Drag into a slot (raycast `handReorderSlot :490`)                                                  | Yes: `reorderHand(from, to)`; codec                                                                                           | Single block only                                                                                                           |
| Reorder rack                                 | `rackSource.end` (`src/table-input.ts:1028-1035`) → `rules.reorderPassive`                                                                | Drag in the rack                                                                                   | Yes: `reorderPassive(from, to)`; codec                                                                                        | Model                                                                                                                       |
| Use an item on a card                        | `rackSource.end` → `rules.applyRackItem(itemId, cardId)` (`src/table-input.ts:1039-1048`)                                                 | Drag a rack item onto a card (raycast `cardUnder`)                                                 | Yes: `applyRackItem`; codec                                                                                                   | `game.applyRackItem`                                                                                                        |
| Buy                                          | Shop drag source → `settleOfferRelease` → `buy(id, destination)` (`src/shop-view.ts:791-830`)                                             | Drag to BUY or the rack                                                                            | Yes: `buy(id, destination)`, plus `purchaseVerdict` as a dry run                                                              | `GameRun`                                                                                                                   |
| Sell                                         | Rack drag onto the Sell bin → `rules.sellPassive` (`src/table-input.ts:1056-1061`)                                                        | Drag only                                                                                          | Yes: `sellPassive(id)`                                                                                                        | `canSellPassives`                                                                                                           |
| Continue / leave shop                        | HUD action presenter → `advanceFromStage` (`src/game-run-controller.ts:486`)                                                              | Click button or cube (cube has a hidden button)                                                    | Yes: `dispatch` / `advanceFromStage`                                                                                          | Refused while busy or dragging                                                                                              |
| Menus, pause, settings, title                | `dispatch(action)` (`src/game-run-controller.ts:794`), `src/menus.ts`                                                                     | DOM buttons, Escape (`keyAction` trait), focus on open                                             | Yes: `dispatch(name)`; menu word cubes already have arrow-key focus (`src/block-menu/choice-keys.ts`)                         | Mode navigation data                                                                                                        |
| Inspect a block                              | `showInspection(block, clientX, clientY)` (`src/table-input.ts:386`)                                                                      | Hover; touch press-and-hold                                                                        | **No**: anchored to pointer coordinates                                                                                       | n/a                                                                                                                         |
| Deck viewer                                  | `deckHud` (`src/hud-panels.ts:151-210`)                                                                                                   | Click, Enter, Space                                                                                | Yes                                                                                                                           | n/a                                                                                                                         |

Passive "activation" (`passiveRackView.activate`, `src/passive-rack.ts:402`) is a scoring presentation pulse, not a player action (verified call site, `src/main.ts`).

**Command vocabulary already present.** `commandCodecs` (`src/command-codecs.ts`) defines `play`, `discard`, `refillHand`, `reorderHand`, `reorderPassive` and `applyRackItem` as plain descriptors with primitive executors (used by replay and setup). `TableRules` (`src/table-input.ts:56-81`) is the presentation-aware rules facade that input calls. `dispatch(action)` covers menu navigation. Buy, sell, select and leave-shop have no codec.

**Keyboard today:** Escape through the `keyAction` scene trait; Enter/Space on the deck HUD; arrow-key focus in block menus; hidden buttons on control-stage cubes. No gamepad code exists anywhere in `src`.

**Documentation drift found.** `doc/game-architecture.md:193` says dnd-kit's keyboard sensor provides keyboard drag and drop, but only `PointerSensor` is configured (`src/table-input.ts:18,351-352`). This should be corrected separately.

## 2. Missing seams (evidence)

1. **No enumeration of legal placements.** Choosing a face is raycast-only. A non-pointer path needs a pure query over `field.blocks()` × 6 faces calling `rules.linePlacement` (plus the empty-field case). That loop does not exist; it looks straightforward to add as a derived, snapshot-scoped query (inferred).
2. **No carry without a pointer.** `DragSource.pick/begin/move/end` all take `Point`s (`src/drag-drop.ts:51-61`), and grid `canDrop(carried, x, y)` is coordinate-only while `drop` uses cached hover state (`gridCandidate`). There is no data-only "carry → choose target → commit" path that still runs the ordinary settle presenters (`settleHandRelease`, `settleOfferRelease`), their sounds and returns.
3. **No public select and no hand focus.** Selection is a private set with only deselect/clear exposed.
4. **Targets hit-tested only geometrically.** Hand slot, rack slot, Sell bin and card-under checks are coordinates (`handReorderSlot`, `rack.slotAt`, `overDiscardArea`, `cardUnder`). The rack's use/sell/reorder decision is inline in `rackSource.end`, not named targets.
5. **Inspection anchored to the pointer.**
6. **Focusable shop offers and rack items** (rack `tabIndex=0`, `src/passive-rack.ts:303`) have no activation key handlers; the bin has `role="button"` without `tabIndex` or keys (`src/table-input.ts:189-190`).
7. **Rotation has only a pixel-delta API**; an analog stick needs a rate-based, per-frame caller on the presentation clock.

The common shape: decisions already belong to drag sources, drop targets and model commands, but **targets are found by hit testing**. Gamepad support needs targets to be **enumerable and addressable** so the same owners can be asked "what are your legal destinations for this carry?" and "accept this one", without fabricating pointer events.

## 3. Browser Gamepad API constraints (primary sources)

From the [W3C Gamepad specification](https://w3c.github.io/gamepad/) and [MDN, "Using the Gamepad API"](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API), read 2026-11-15:

- **Polling, not events, for input.** `navigator.getGamepads()` returns a snapshot. The spec recommends sampling inside `requestAnimationFrame`. MDN advises reading the current snapshot each frame instead of holding an old `Gamepad` object. `timestamp` reports new data (MDN notes Firefox lacks it).
- **Exposure needs a gamepad gesture.** Until the user presses a button or moves an axis past a threshold while the page is visible, `getGamepads()` is empty and `gamepadconnected` may not fire (an anti-fingerprinting measure). A connected pad can therefore appear "absent" until touched; the UI must say so instead of assuming none.
- **Mapping varies.** Only `mapping === "standard"` guarantees the layout: buttons 0–3 face (bottom, right, left, top), 4–5 bumpers, 6–7 triggers, 8–9 centre (select/start), 10–11 stick presses, 12–15 D-pad (up, down, left, right), 16 home; axes 0–1 left stick, 2–3 right stick. `mapping === ""` means raw, unknown indices, so a remapping screen is needed rather than a guess.
- **Indices are reused** after a disconnect. Track pads by index and live `connected`, and handle `gamepaddisconnected`.
- **Permissions policy.** There is a policy-controlled feature `gamepad` (default allowlist `*`); if it is disabled, `getGamepads()` throws `SecurityError`. This matters if the game is ever embedded.
- **Haptics are optional and in flux.** `vibrationActuator` with `dual-rumble` / `trigger-rumble` exists on some devices, and effects stop for hidden documents. The spec is marked a work in progress. Haptics must be a decoration, never required.
- **Layouts differ by brand** (Xbox A/B/X/Y versus PlayStation ✕/○/□/△ versus Nintendo's swapped A/B), so on-screen prompts should name the **standard position** with a per-family glyph set, not one brand's letters.

## 4. Schemes compared (proposal)

| Scheme                                        | How a card is placed                                                                                    | Strengths                                                                                                               | Weaknesses                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **A. Virtual cursor** (stick moves a pointer) | Steer a cursor onto a face, as a mouse would                                                            | Reuses hit tests directly                                                                                               | Fabricates pointer input (against the architecture); slow and imprecise for small, occluded faces; poor for accessibility |
| **B. Discrete focus navigation**              | D-pad/stick steps a focus between legal targets; A confirms                                             | Precise, accessible, fast with few targets; matches "model first"                                                       | Needs the target enumeration seam; spatial "next target" ordering must feel natural on a rotating 3D structure            |
| **C. Hybrid (recommended for discussion)**    | Discrete focus for hand, rack, shop and legal placements; right stick for camera rotation and zoom only | Precise choices with free viewing; occluded faces reached by rotating the view, while focus stays on legal targets only | Two concepts to teach (focus versus camera), mitigated by always-visible prompts                                          |

**Recommendation for discussion: C.** It never fabricates pointer events. Every choice goes through the existing drag source and drop target owners via enumerable targets. Camera movement stays view-only.

## 5. Proposed mapping (standard layout; for owner discussion)

Contexts, each with a persistent prompt strip naming the buttons available now:

```text
Hand ──A (pick up focused/selected)──▶ Carrying ──A (commit)──▶ Hand
  │  ▲                                   │  B (cancel, return)  ▲
  │  └────────────── B ──────────────────┘                      │
  ├─ LB/RB ─▶ Rack ── A (pick up item) ─▶ Carrying item ── A ───┘
  └─ Start ─▶ Pause menu (existing focus model)
Shop: same as Hand/Rack with offers as sources; Continue is a focused control.
```

| Input              | Hand / Rack (not carrying)                                                 | Carrying (card line or item)                                                                                                  | Menus      |
| ------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------- |
| D-pad / left stick | Move focus along hand or rack                                              | Step focus between **legal** destinations: placement faces ordered by screen position, hand slots, bin, Sell, BUY, rack slots | Move focus |
| A (bottom)         | Pick up the focused card, or the selection if the focused card is selected | Commit to the focused destination                                                                                             | Activate   |
| B (right)          | Deselect all                                                               | Cancel and return                                                                                                             | Back       |
| X (left)           | Toggle selection of the focused card (multi-select)                        | Rotate placement orientation, if a carried arrangement ever matters (none today)                                              | n/a        |
| Y (top)            | Inspect focused (anchored to the block)                                    | Inspect focused destination's block                                                                                           | n/a        |
| LB / RB            | Switch focus region: hand ⇄ rack (⇄ shop stock in the shop)                | Previous/next destination group (faces, then hand, then bin)                                                                  | Tabs       |
| Right stick        | Rotate the view (rate-based, presentation clock)                           | Same: reveal occluded faces; destination list updates live                                                                    | n/a        |
| LT / RT            | Zoom out / in                                                              | Same                                                                                                                          | n/a        |
| Select / View      | Deck viewer                                                                | n/a                                                                                                                           | n/a        |
| Start / Menu       | Pause                                                                      | Pause (the carry is cancelled through the existing `pausesBelow` path)                                                        | Resume     |

- **Multi-select without a pointer:** X toggles the focused card; A picks up the whole selection (the existing line-drag semantics); B clears.
- **Occluded faces:** a face is listed only if legal; the right stick rotates the view to bring it into sight. A focused face that is off-screen auto-orients the camera toward it, as a configured presentation behaviour rather than a gameplay rule.
- **Discard:** while carrying, the bin is one destination; while not carrying, a held B or a dedicated binding could discard the selection through the existing bin-click path (open question).
- **Model-first responsiveness:** commits call the same rules as a drop. Focus movement is never blocked by running animations (#272).

## 6. Architecture fit (proposal)

- **A gamepad adapter** polls on the presentation frame and turns buttons and axes into **semantic input commands** (`focusNext(direction)`, `pickUp`, `commit`, `cancel`, `toggleSelect`, `inspect`, `rotateView(rate)`, `zoom(rate)`). It knows no scene, material or block identity.
- **Enumerable targets:** each drop target owner gains an optional "destinations for this carry" query that returns addressable candidates (for the grid: the derived legal-placement query from seam 1), plus an "accept candidate" entry that runs its ordinary `drop`/settle path. The adapter never asks what a target is; it asks targets to list themselves.
- **Carry without coordinates:** drag sources gain a data-only begin/end that reuses `settleHandRelease` and `settleOfferRelease`, so sounds, flights and returns stay identical.
- **Focus and prompts** live in a presentation controller trait composed by scenes that support gamepad play, not as branches in `main.ts` or the input adapter.
- **Remapping** is configuration (schema-owned bindings per mapping family), persisted per device `id` where `mapping` isn't `standard`.
- **Input method switching:** the last-used method decides whether the prompt strip and focus ring show; pointer and gamepad can interleave, and a disconnect mid-carry cancels the carry through the existing cancel path.
- **Not required:** replacing dnd-kit or use-gesture. Pointer input keeps its current sensors.

## 7. Uncertainties

- Spatial ordering of placement faces for D-pad stepping on a rotating 3D structure needs an experiment (nearest-in-direction on screen versus a fixed traversal order).
- Whether auto-orienting the camera toward a focused face is comfortable or disorienting.
- Exact discard binding outside a carry.
- Safari's current Gamepad support and mapping quality were not checked in this pass.
- Whether a future rule ever makes carried orientation gameplay-relevant; today it doesn't (inferred).

## 8. Validation limits

No controller was tested and no browser experiment was run; the API facts come from the specification and MDN, not device trials. Line references are at the audited revision. Some claims (rotation being view-only, word-cube Continue keyboard reachability, `presenter.play` needing rendered blocks) are inferred, not traced end to end.

## 9. A small first experiment, then tickets (after design agreement)

1. **Experiment (dev-only):** the legal-placement enumeration query plus a D-pad focus ring over placement faces in a dev mode, committing through the grid's ordinary drop path. Measure whether face stepping on a rotated structure feels predictable. No production wiring.
2. Then, if agreed, focused tickets in this order: correct the keyboard-sensor doc drift; the enumerable-target capability (doc first); data-only carry for hand, rack and shop sources; the semantic command adapter and gamepad polling; focus/prompt controller trait with glyph families; remapping and persistence; optional haptics.
