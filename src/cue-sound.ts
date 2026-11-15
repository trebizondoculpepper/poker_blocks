/**
 * A configured sound answering a presentation cue (#1080; doc/line-goes-up.md, "Triggered
 * attachment-release effect"). Hearing the cue schedules its captured sound on the shared
 * scheduler after the configured delay in game-time units, in a scope this controller owns;
 * disposing it (the scene leaving) cancels what has not played. It never decides an outcome,
 * reads live state or touches the object that sent the cue. Muting follows the shared settings.
 */
import type { SoundEffectId } from "./audio/sfx-registry";
import { playSfx } from "./audio/sfx";
import { unitMs, visualHandlers, type ScopeHandle } from "./visual-events/scheduler";

export type CueSoundConfig = {
  sound: SoundEffectId;
  /** How long after the cue it plays, in game-time units. */
  delayUnits: number;
};

export const cueSoundHandler = "cue.sound";
visualHandlers.register(cueSoundHandler, (payload) => {
  playSfx((payload as { sound: SoundEffectId }).sound);
  return "done";
});

type CueSoundScheduler = {
  createScope(parent: ScopeHandle | null): ScopeHandle;
  schedule(
    scope: ScopeHandle,
    description: { handler: string; payload?: unknown; dueUnits: number },
  ): { accepted: boolean };
  seal(scope: ScopeHandle): boolean;
  cancel(target: ScopeHandle): void;
  readonly nowMs: number;
};

export function createCueSound(scheduler: CueSoundScheduler, config: CueSoundConfig) {
  const scopes = new Set<ScopeHandle>();
  let disposed = false;
  return {
    /** The cue was heard: its sound plays once, after the configured delay. */
    hear(): void {
      if (disposed) return;
      const scope = scheduler.createScope(null);
      scopes.add(scope);
      scheduler.schedule(scope, {
        handler: cueSoundHandler,
        payload: { sound: config.sound },
        dueUnits: scheduler.nowMs / unitMs + config.delayUnits,
      });
      scheduler.seal(scope);
    },
    /** Leaving: cancel every sound not yet played. */
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const scope of scopes) scheduler.cancel(scope);
      scopes.clear();
    },
  };
}
