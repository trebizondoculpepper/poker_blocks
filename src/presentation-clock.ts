/**
 * A held presentation clock (#530; doc/foreground-menus.md, "Composition and layer ownership"):
 * the time the playfield's presentation (camera, board, hand, rack) is drawn at. While any scene
 * holds it, that time stands still and its frame delta is zero, so the covered playfield shows
 * an exact frozen pose. Releasing it carries on from that pose: the held span is skipped rather
 * than caught up. Only the playfield reads it; the shared frame clock, the music and the
 * foreground menus keep running.
 */
export type PresentationClock = {
  /** Freeze the presentation until the returned release is called (holds nest). */
  hold(): () => void;
  /** This frame's presentation time and delta, from the shared frame's. */
  advance(time: number, delta: number): { time: number; delta: number };
};

export function createPresentationClock(): PresentationClock {
  let holds = 0;
  /** How far presentation time lags frame time: every held span so far. */
  let lag = 0;
  let lastFrame: number | null = null;
  return {
    hold() {
      holds++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds--;
      };
    },
    advance(time, delta) {
      // A held frame adds its whole span to the lag, so presentation time stays put.
      const step = lastFrame === null ? 0 : time - lastFrame;
      lastFrame = time;
      const held = Math.min(holds, 1);
      lag += step * held;
      return { time: time - lag, delta: delta * (1 - held) };
    },
  };
}
