/**
 * Drag-ghost gesture timing and ownership (#1084; doc/drag-ghost-audition.md, "Gesture timing and
 * ownership"). A controller that, at a drag's `began`, captures immutable settings and the source
 * under a new gesture generation, then — on the one shared visual-event scheduler — waits the
 * captured delay and drives the ghost transition's progress 0→1 over the captured duration.
 *
 * - **Owns when, not how.** The transition/endpoint rendering is an adapter (#1199 supplies the
 *   real one); this controller only creates it, feeds it progress and transforms, and releases it.
 * - **No private timers.** The delay is the event's due time; the fade is a scheduler effect.
 * - **Ends once.** Ended (accepted or rejected), cancelled, lost capture, blur, source removal or
 *   scene exit all invalidate the generation and cancel the gesture scope. A rejected or cancelled
 *   gesture restores the source before its ordinary return; an accepted one releases the
 *   decoration at the normal flight handoff. A quick drop before the delay never ghosts anything.
 * - **Baseline** composes no decoration at all; **reduced motion** shows the endpoint at once.
 *
 * Input is never refused or queued for any of this.
 */
import {
  unitMs,
  visualHandlers,
  type EffectHandle,
  type ScopeHandle,
} from "./visual-events/scheduler";

/** The settings a gesture captures at `began`; later edits affect the next gesture only. */
export type GhostTimingSettings = Readonly<{
  /** Game-time units from pickup to the ghost starting. */
  delayUnits: number;
  /** Game-time units the transition takes. */
  durationUnits: number;
  /** No ghost decoration at all. */
  baseline: boolean;
  reducedMotion: boolean;
}>;

/** One gesture's ghost decoration, from the transition/endpoint capability (#1199). */
export type GhostDecoration = {
  /** Transition progress, 0 (source) to 1 (endpoint). */
  setProgress(progress: number): void;
  /** The carried transform changed. */
  follow?(transform: unknown): void;
  /** Put the original source appearance back, before its ordinary return. */
  restoreSource(): void;
  /** Release masks, endpoint and targets. */
  release(): void;
};

export type GhostDecorationFactory = (
  source: unknown,
  settings: GhostTimingSettings,
) => GhostDecoration;

/** How a gesture ended. */
export type GhostGestureEnd = "accepted" | "rejected" | "cancelled";

type Running = { decoration: GhostDecoration | null; durationMs: number; ended: boolean };
const gestures = new Map<string, Running>();
let nextGesture = 0;

visualHandlers.register("ghost.transition", (payload, context): "done" | EffectHandle => {
  const id = (payload as { gesture: string }).gesture;
  const gesture = gestures.get(id);
  if (!gesture || gesture.ended || !gesture.decoration) return "done";
  const decoration = gesture.decoration;
  // Anchored to the scheduled start, so a late first frame doesn't shorten the fade (#1291).
  const start = context.scheduledAtMs;
  if (gesture.durationMs <= 0) {
    decoration.setProgress(1);
    return "done";
  }
  return {
    update(nowMs) {
      if (gesture.ended) return "finished";
      const progress = Math.min(1, (nowMs - start) / gesture.durationMs);
      decoration.setProgress(progress);
      return progress >= 1 ? "finished" : "running";
    },
    cancel() {},
    dispose() {},
  };
});

type GhostScheduler = {
  readonly nowMs: number;
  createScope(parent: ScopeHandle | null): ScopeHandle;
  schedule(
    scope: ScopeHandle,
    description: { handler: string; payload?: unknown; dueUnits: number },
  ): { accepted: boolean };
  seal(scope: ScopeHandle): boolean;
  cancel(target: ScopeHandle): void;
};

export function createGhostTiming(scheduler: GhostScheduler, decorate: GhostDecorationFactory) {
  let generation = 0;
  return {
    get generation() {
      return generation;
    },
    /** A drag began: capture its settings and source, and schedule its ghost. */
    began(source: unknown, settings: GhostTimingSettings) {
      const mine = ++generation;
      const captured = Object.freeze({ ...settings });
      const id = `ghost-${++nextGesture}`;
      const running: Running = {
        decoration: null,
        durationMs: captured.durationUnits * unitMs,
        ended: false,
      };
      let scope: ScopeHandle | null = null;
      if (!captured.baseline) {
        running.decoration = decorate(source, captured);
        if (captured.reducedMotion) running.decoration.setProgress(1);
        else {
          running.decoration.setProgress(0);
          gestures.set(id, running);
          scope = scheduler.createScope(null);
          const admitted = scheduler.schedule(scope, {
            handler: "ghost.transition",
            payload: { gesture: id },
            dueUnits: scheduler.nowMs / unitMs + captured.delayUnits,
          });
          // Not admitted: decoration is cosmetic; show the endpoint rather than wait forever.
          if (!admitted.accepted) running.decoration.setProgress(1);
          scheduler.seal(scope);
        }
      }
      const end = (how: GhostGestureEnd) => {
        if (running.ended) return false;
        running.ended = true;
        gestures.delete(id);
        if (scope) scheduler.cancel(scope);
        const decoration = running.decoration;
        running.decoration = null;
        if (decoration) {
          if (how !== "accepted") decoration.restoreSource();
          decoration.release();
        }
        return true;
      };
      return {
        settings: captured,
        /** Still the current gesture: a newer `began` makes it stale. */
        get current() {
          return mine === generation && !running.ended;
        },
        /** The carried transform changed: follow it, without restarting the delay. */
        changed(transform: unknown) {
          if (!running.ended) running.decoration?.follow?.(transform);
        },
        /** Ended, cancelled, lost capture, blur, removal or exit: once. */
        end,
      };
    },
  };
}

export type GhostTiming = ReturnType<typeof createGhostTiming>;
export type GhostGesture = ReturnType<GhostTiming["began"]>;
