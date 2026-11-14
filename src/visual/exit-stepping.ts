/**
 * Block exits on a scheduler of their own, stepped by hand (#549): for tests and the profiler,
 * which drive their own time in seconds. The game presents exits on its one shared scheduler
 * (`createExitPresenter` with the scheduler the frame loop advances); this only supplies a clock
 * for code that has no frame loop. Exits are started at once, as they would be on the next frame.
 */
import { createVisualScheduler } from "../visual-events/scheduler";
// The entry point that registers every exit effect, so stepped exits play them (#1035 review).
import { createExitPresenter } from "./exit-effects";
import type { ExitPresenter, ExitSequence, ExitSnapshot, ExitVisual } from "./exit-presentation";

export function createSteppedExits(reducedMotion: () => boolean = () => false) {
  let presenter: ExitPresenter | null = null;
  const scheduler = createVisualScheduler({
    services: {
      get blockExits() {
        return presenter!.blockExits;
      },
    },
  });
  presenter = createExitPresenter(scheduler, reducedMotion);
  const exits = presenter;
  let realMs = 0;
  scheduler.update(realMs, true);
  return {
    scheduler,
    start(snapshot: ExitSnapshot, visual: ExitVisual, sequence: ExitSequence): void {
      exits.start(snapshot, visual, sequence);
      // Same clock time: starts it without advancing anything.
      scheduler.update(realMs, true);
    },
    /** Advance every exit by `delta` seconds. */
    update(delta: number): void {
      realMs += delta * 1000;
      scheduler.update(realMs, true);
      // The scheduler keeps settled scopes until its generation ends: with no exit left, end
      // it, so a profiler repeating exits holds no growing record (#1035 review).
      if (exits.active === 0 && scheduler.counts.scopes > 0) scheduler.disposeGeneration();
    },
    cancel: (blockId: string) => exits.cancel(blockId),
    get active(): number {
      return exits.active;
    },
    dispose: () => exits.dispose(),
  };
}
