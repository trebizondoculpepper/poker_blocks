/**
 * A narrow capability over the application's frame loop (#735 review): while anything holds a
 * pause, the loop keeps its animation frame scheduled but neither updates nor renders. A
 * developer tool measuring the GPU uses it so the game's rendering doesn't share its frames. It
 * knows nothing about who asks or why.
 */
export function createRenderGate() {
  let holds = 0;
  return {
    /** Pause the loop; returns how to resume (once). */
    pause(): () => void {
      holds++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds--;
      };
    },
    /** Whether the loop should update and render this frame. */
    get open(): boolean {
      return holds === 0;
    },
    /** Run one frame's step, unless a pause is held. */
    run(time: number, step: (time: number) => void): void {
      if (holds === 0) step(time);
    },
  };
}

export type RenderGate = ReturnType<typeof createRenderGate>;
