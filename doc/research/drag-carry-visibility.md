# Seeing the attachment face while carrying hand cards (#1047)

Research for the owner's feature request: when cards are dragged from the hand to the grid, the carried card hides the face the player is aiming at. This report is source-backed findings, options and a recommendation for discussion. **No design is chosen here.** The agreed behaviour goes into a separate design PR, and implementation follows in focused slices.

Source audit at `82be9d3` (main, 2026-11-14).

## What hides the target (findings)

1. **The carried card sits on the aim point.** `moveDraggedBlock` (`src/table-input.ts`) puts the dragged cube where the pointer ray meets the hand camera's drag plane, plus `grabOffset`, the offset from where the press landed on the cube. The drop target is hit-tested at the pointer itself: `updateCandidate` calls `dragDrop.hitTest(playOrder, lastX, lastY)`, and the grid's attachment pick uses the same point. The pointer is always over the carried cube, wherever on it the press went down. So **the face being chosen is always behind the card being carried**, by construction rather than by chance.
2. **It is drawn over everything.** `beginHandDrag` moves the carried cubes to the drag layer (`setDragLayer`). `src/table-renderer.ts` draws the drag layer last, on the front canvas, after `clearDepth()`. Nothing in the board can show in front of it, including the drop preview.
3. **A line drag hides more.** A multi-card drag fans the rest of the selection behind and slightly up-right of the dragged cube, each a block further from the camera (`moveDraggedBlock`'s `fanOffset` and `awayFromCamera`). On screen they cover more of the board near the aim point.
4. **The preview is underneath.** `field-view.ts` already previews a drop: a translucent `ghost` cube with a laser outline (`createLaserOutline`) at each cell the play would fill, and the attachment face it would join. That preview is in the board scene, so the carried card covers it too.
5. **It gets worse as the deck runs down.** The table thins out late in a stage, and the camera frames the structure more tightly (`cameraView` follows the field), so each face is larger on screen but sits closer to where the hand is carried. That matches the owner's observation, though I haven't measured it (see "Limits").

So the problem is **where** the card is carried and **in which pass** it is drawn, not only how opaque it is. Making the card see-through treats the symptom: the aim point still sits under it.

## Constraints from the code

- **Materials differ widely in how they would take a ghost.**
  - Standard materials (`MeshStandardMaterial` faces) can be made translucent.
  - Several looks are custom `ShaderMaterial`s or extras that ignore `opacity`: crystal fire, fire core, crystal internal/refraction fronts, filled vessels and fading film. `src/visual/exit-fade.ts` and the Prismatic Crystal exit already document that "shader-driven fire ignores opacity".
  - A plain opacity ghost would therefore leave some cards fully solid, or need a per-material special case, which the rules forbid.
- **Transparency means depth-ordering trouble.** Translucent cubes and their contents (contained fluid, fire, glass) need sorting. With depth writes off, faces of a cube show through each other. The existing fade remembers and restores `opacity`, `transparent`, `depthWrite` and `alphaTest` per material, and composes overlapping fades (#490). That is the right model if a ghost changes materials, but it is still per-material work.
- **There is a material-agnostic tool already.** `createMaterialise` (`src/visual/materialise.ts`) clones a cube's materials and patches them through `onBeforeCompile` with a Perlin dissolve that discards fragments. Used at a fixed partial threshold, it would be a stipple ghost: no sorting problems, works on any material whose shader it can patch, and it already disposes what it clones. Its patch targets standard shader chunks; custom `ShaderMaterial`s would need checking.
- **Outlines exist.** Every block has an edge outline (`blockOutline`), and the drop preview has a laser outline. An outline-only carry, with faces hidden and edges kept, is cheap and identity-free. But it loses rank, suit and material, which the ticket asks to keep where useful.
- **Input ownership.** Only the drag source and drop targets decide pickup, accept and reject (AGENTS.md, "Input ownership"). Any of these options is presentation of an existing gesture: it changes where or how the carried card is drawn, never the hit-test point, legality or timing.

## Options

| Option                                                                                              | What stays visible on the carried card            | How the target face is exposed            | Cost                                                                                | Risks                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Carry offset** (the card rides above-left or above the pointer, at a configured screen offset) | Everything: full material, rank/suit, fan         | The aim point is no longer under the card | None: a position change in `moveDraggedBlock`                                       | The card no longer "sits in the hand" under the finger. On touch this helps a lot, because the finger covers the aim point too. The offset needs clamping at the screen edges. |
| **B. Dissolve ghost** (a fixed partial threshold of the existing Perlin dissolve while carried)     | Rank/suit and material colour, broken up by holes | Through the holes                         | One material clone per carried face (the same as a discard dissolve), freed on drop | Patch coverage of custom shaders; it reads as "dissolving" (discard's language) unless restyled                                                                                |
| **C. Translucent ghost** (opacity on the carried materials, fade-style save/restore)                | Everything, faded                                 | Through the card                          | No clones (in-place, as the fade does)                                              | Sorting artefacts with contained/transparent looks; opacity-ignoring shaders stay solid; needs `depthWrite` handling                                                           |
| **D. Outline only** (faces hidden, edges plus a small rank/suit tag)                                | Edges, plus a tag if added                        | Fully                                     | Cheap                                                                               | Loses material identity; a new tag element is new UI                                                                                                                           |
| **E. Shrink over the grid** (the carried card scales down while a grid target is hovered)           | Everything, smaller                               | Mostly, around the small card             | None                                                                                | Changes the feel of the carry; still centred on the aim point                                                                                                                  |

They combine: A + B (offset and a light ghost) or A + E are both natural.

## Recommendation for discussion

Start with **A (carry offset) as a configured drag-appearance capability**: a registered drag-appearance handler on the hand drag source, configured as data (offset in screen units, clamping, whether it applies to touch only or all pointers). It costs nothing to render. It fixes the actual cause (finding 1) for every material without touching shaders, and keeps the card fully recognisable.

If the owner still wants to see "through" the card after auditioning A, add **B (dissolve ghost)** as a second registered appearance step. It reuses `createMaterialise`'s clone, patch and dispose ownership rather than a new per-material mechanism. **C** is the option most likely to need material-specific handling and is not recommended as the first step.

Whichever is chosen, the lifecycle is the drag source's: applied at `began`, updated at `changed`, removed on `ended`, `cancelled`, lost capture, reject/fly-back and scene exit. The handler never asks what card or material it is carrying.

## Proposed audition (dev-only)

A Dev trait on an existing dev play room, for example `devDragAppearanceAudition`, with live controls: offset x/y in game units, a dissolve-ghost threshold (off by default), and shrink-over-grid on/off. It would use the same hand, grid and drop preview as play, with a mixed-material deck (opaque, transparent, contained and crystal). The owner drags single cards and three-card lines on desktop and touch, then picks the combination. The design PR then records the chosen defaults.

## Limits of this research

- **Not tested in a browser:** this is a source audit. The browser tool here can only perform a drag as one atomic gesture, so it can't hold a card mid-drag for a screenshot, and synthetic pointer events don't start dnd-kit drags. The screenshots and clips the ticket asks for need the audition room above or a person dragging.
- **Not measured:** on-screen coverage (the carried card's projected size against a face's, by camera distance and deck size), and the extra cost of options B and C. The costs in the table come from the code (clone counts and passes), not from profiler runs.
- **Not checked:** whether `createMaterialise`'s patch covers every custom shader. That needs a per-assembly check before B could be a default.
