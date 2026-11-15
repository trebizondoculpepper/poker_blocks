/**
 * materialChangeSounds (#539; doc/presentation-contracts.md, "Committed transition fact and
 * independent responses"): the audio response to a committed material transition. For each
 * `block.materialChanged` fact it schedules the captured target sound on the shared visual-event
 * scheduler, in a scope this trait owns, at the transition's start. Each committed fact plays at
 * most once (its event ID is the occurrence); leaving the scene cancels what has not played. It
 * never reads live state, depends on any visual or decides anything.
 */
import type { SoundEffectId } from "../audio/sfx-registry";
import type { EventEnvelope } from "../lifecycle/action";
import type { GameEvent } from "../passives";
import type { SceneTraitBehaviour } from "../scenes";
import { unitMs, visualHandlers, type ScopeHandle } from "../visual-events/scheduler";
import type { ShopExitScheduler } from "./shop-leave-response";

/** What the scheduled handler reaches through the scheduler's services. */
export type TransitionAudioServices = { transitionAudio: { play(id: SoundEffectId): void } };

export const transitionSoundHandler = "material.transitionSound";
visualHandlers.register(transitionSoundHandler, (payload, context) => {
  (context.services as TransitionAudioServices).transitionAudio.play(
    (payload as { sound: SoundEffectId }).sound,
  );
  return "done";
});

export function materialChangeSounds<
  Context extends {
    services: {
      run: { onCommitted(listener: (facts: readonly EventEnvelope[]) => void): () => void };
      visualEvents: ShopExitScheduler;
    };
  },
>(): SceneTraitBehaviour<Context, Record<never, never>> {
  const live = new WeakMap<object, { stop(): void; scope: ScopeHandle }>();
  /** Committed transitions already scheduled: a redelivery never plays twice. */
  const scheduled = new Set<string>();
  const release = (config: object, visualEvents: ShopExitScheduler) => {
    const held = live.get(config);
    if (!held) return;
    held.stop();
    visualEvents.cancel(held.scope);
    live.delete(config);
  };
  return {
    enter({ services }, config) {
      release(config, services.visualEvents);
      const { visualEvents } = services;
      const scope = visualEvents.createScope(null);
      const stop = services.run.onCommitted((facts) => {
        for (const { eventId, payload } of facts) {
          const { transitionSound } = payload as GameEvent;
          if (!transitionSound || scheduled.has(eventId)) continue;
          scheduled.add(eventId);
          if (scheduled.size > 256) scheduled.delete(scheduled.values().next().value!);
          visualEvents.schedule(scope, {
            handler: transitionSoundHandler,
            payload: { sound: transitionSound },
            dueUnits: visualEvents.nowMs / unitMs,
          });
        }
      });
      live.set(config, { stop, scope });
    },
    exit({ services }, config) {
      release(config, services.visualEvents);
    },
  };
}
