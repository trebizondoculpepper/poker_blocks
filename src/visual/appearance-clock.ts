/**
 * The clock self-timed appearance parts read (#972; doc/presentation-contracts.md, "Profiler
 * animation fidelity (#752)"): contained contents, the flame core and ice's running drops each
 * advance from it in their own render hook. By default it is the frame's time (the document
 * timeline, the same for every part drawn in one frame), so the game is unchanged. A host that
 * owns an explicit presentation clock, such as the profiler's fixed-step run clock, installs it
 * until the returned function restores the previous one, so every part advances in step with
 * that host's updates and passes and a run repeats exactly.
 */

/** The current frame's time, in seconds: the same for every part drawn in one frame. */
function frameSeconds(): number {
  const time = typeof document === "undefined" ? null : document.timeline?.currentTime;
  return (typeof time === "number" ? time : performance.now()) / 1000;
}

let source: () => number = frameSeconds;

/** This frame's appearance time, in seconds. */
export const appearanceSeconds = (): number => source();

/** Read appearance time from `clock` (seconds) until the returned function restores the last. */
export function useAppearanceClock(clock: () => number): () => void {
  const previous = source;
  source = clock;
  return () => {
    source = previous;
  };
}
