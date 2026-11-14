/**
 * A held presentation clock (#530; doc/foreground-menus.md, "Composition and layer ownership"):
 * the time the playfield's presentation (camera, board, hand, rack) is drawn at. While any scene
 * holds it, that time stands still at the moment of the first hold and its frame delta is zero,
 * so the covered playfield shows an exact frozen pose. Released, it is frame time again: it never
 * lags behind, because animation producers stamp their starts with frame time (`performance.now()`),
 * so anything still in flight simply catches up on resume. Only the playfield reads it; the shared
 * frame clock, the music and the foreground menus keep running.
 */
export type PresentationClock = {
  /** Freeze the presentation until the returned release is called (holds nest). */
  hold(): () => void;
  /** This frame's presentation time and delta, from the shared frame's. */
  advance(time: number, delta: number): { time: number; delta: number };
};

export function createPresentationClock(): PresentationClock {
  let holds = 0;
  /** The time the presentation stands at while held, from its first held frame. */
  let frozenAt: number | null = null;
  return {
    hold() {
      holds++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds--;
        if (holds === 0) frozenAt = null;
      };
    },
    advance(time, delta) {
      if (holds === 0) return { time, delta };
      frozenAt ??= time;
      return { time: frozenAt, delta: 0 };
    },
  };
}
