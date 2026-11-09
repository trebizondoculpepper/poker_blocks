# Touch testing

How touch play is checked (issue #5), and what was last tested.

## Gestures

| Gesture                                                             | Expected result                                                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Tap a hand or field block                                           | Toggles its selection. Doesn't drag or rotate.                                                                  |
| Drag a hand block onto an exposed face                              | Plays it there, with the target preview while dragging.                                                         |
| Drag a hand block onto Discard                                      | Discards it (and any other selected hand blocks).                                                               |
| Drop anywhere else, or the browser cancels                          | The block returns; no play or discard is spent.                                                                 |
| One-finger drag on the structure                                    | Turns it on two axes. Lifting doesn't select a block.                                                           |
| Press and hold a block (about half a second, without moving)        | Shows its description above the finger, clear of the hand. Lifting hides it and doesn't select, play or rotate. |
| A second finger during a drag                                       | Cancels the drag (the block returns) and starts a pinch zoom.                                                   |
| The app is hidden, loses focus or loses pointer capture mid-gesture | Nothing completes; a dragged block returns.                                                                     |

## Manual checklist

Hit testing (Three.js raycasts):

- Tapping near a cube's edge selects that cube, not the one behind it.
- A drag preview appears only on exposed faces; the hand cube under the finger is never its own target.
- After rotating the structure, taps still select the cube under the finger.

Layout:

- The hand, Discard target, deck counter, HUD and passive rack don't overlap at the sizes below, in portrait and landscape.
- The Discard target is at least 44 px in each direction.
- Safe-area insets (a notch or home indicator) don't hide any control.

## Last run

2026-11-09, Chrome (headless) with mobile emulation and touch events via the DevTools protocol, in `?mode=dev1`:

| Size              | Viewport   | Result                                                                                                                 |
| ----------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| Phone             | 390 × 844  | All gestures above pass.                                                                                               |
| Large phone       | 430 × 932  | All gestures above pass.                                                                                               |
| Tablet (portrait) | 820 × 1180 | All gestures above pass, after moving Discard and the deck counter above the hand (they had overlapped the end cards). |
| Desktop mouse     | 1280 × 800 | Select, group drag to Discard, click-discard and refused drop unchanged.                                               |

**Not yet done:** a run on a real touch device (iOS Safari and Android Chrome).
