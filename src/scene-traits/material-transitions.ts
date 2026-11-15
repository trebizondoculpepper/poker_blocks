/**
 * materialTransitions (#1167; doc/presentation-contracts.md, "Committed transition fact and
 * independent responses"): the visual response to a committed material transition, composed
 * beside (and independent of) `materialChangeSounds`. For each `block.materialChanged` fact it
 * schedules the registered transition on the shared visual-event scheduler, in a scope this trait
 * owns, at the transition's start (as its sound is). Each committed fact is shown at most once
 * (its event ID is the occurrence); a newer change to the same block replaces an older one still
 * waiting or running; leaving the scene cancels everything it started.
 *
 * Which transition: the action's own response, if its fact carries one, else this scene's
 * configured default, else `perlinDissolve`. It never reads live state or decides anything.
 */
import type { CardBlock } from "../cards";
import { Registry } from "../core/registry";
import type { EventEnvelope } from "../lifecycle/action";
import {
  captureTransition,
  defaultMaterialTransition,
  forgetTransition,
  materialTransitionHandler,
  type MaterialTransitionRequest,
  type MaterialTransitionSettings,
} from "../material-transitions";
import type { SceneTraitBehaviour } from "../scenes";
import { unitMs, type ScopeHandle } from "../visual-events/scheduler";
import type { ShopExitScheduler } from "./shop-leave-response";

/** The scene's default transition and its settings. */
export type MaterialTransitionsConfig = MaterialTransitionSettings & { handler?: string };

type TransitionScheduler = Pick<ShopExitScheduler, "createScope" | "schedule" | "cancel" | "nowMs">;

/** What a committed transition fact carries that this reads. */
type TransitionFact = {
  blockId?: string;
  snapshots?: { before?: CardBlock };
  /** An action's own transition response, overriding the scene's. */
  materialTransition?: { handler: string; settings?: MaterialTransitionSettings };
};

/**
 * Committed facts that change a block's look as a material transition, by the fact they are: each
 * reads its block and captured old card, so the trait dispatches without asking what happened.
 */
export const transitionFacts = new Registry<(payload: unknown) => TransitionFact>(
  "material transition fact",
);
transitionFacts.register("block.materialChanged", (payload) => payload as TransitionFact);

export function materialTransitions<
  Context extends {
    services: {
      run: { onCommitted(listener: (facts: readonly EventEnvelope[]) => void): () => void };
      visualEvents: TransitionScheduler;
    };
  },
>(): SceneTraitBehaviour<Context, MaterialTransitionsConfig> {
  const live = new WeakMap<object, { stop(): void; scope: ScopeHandle; held: Set<string> }>();
  const release = (config: object, visualEvents: TransitionScheduler) => {
    const entry = live.get(config);
    if (!entry) return;
    entry.stop();
    visualEvents.cancel(entry.scope);
    // Requests whose events never dispatched are forgotten with them.
    for (const id of entry.held) forgetTransition(id);
    live.delete(config);
  };
  return {
    enter({ services }, config) {
      release(config, services.visualEvents);
      const { visualEvents } = services;
      const scope = visualEvents.createScope(null);
      // Fresh for each entry, so a new run's restarted event IDs are never taken for old ones.
      const shown = new Set<string>();
      const held = new Set<string>();
      const stop = services.run.onCommitted((facts) => {
        for (const { eventId, type, payload } of facts) {
          if (!transitionFacts.has(type)) continue;
          const fact = transitionFacts.get(type)(payload);
          const before = fact.snapshots?.before;
          if (!fact.blockId || !before || shown.has(eventId)) continue;
          shown.add(eventId);
          if (shown.size > 256) shown.delete(shown.values().next().value!);
          const own = fact.materialTransition;
          const request: MaterialTransitionRequest = {
            blockId: fact.blockId,
            before,
            settings: { ...config, ...own?.settings },
          };
          // A newer change to the same block replaces one still running (the handler does).
          // The captured card stays out of the payload (its traits carry functions); it's named.
          const id = captureTransition(request);
          const admitted = visualEvents.schedule(scope, {
            handler: materialTransitionHandler,
            payload: {
              handler: own?.handler ?? config.handler ?? defaultMaterialTransition,
              request: id,
            },
            dueUnits: visualEvents.nowMs / unitMs,
          });
          if (admitted.accepted) {
            held.add(id);
            if (held.size > 256) forgetTransition(held.values().next().value!);
          } else {
            forgetTransition(id);
            console.warn(`a material transition was not admitted: ${admitted.reason}`);
          }
        }
      });
      live.set(config, { stop, scope, held });
    },
    exit({ services }, config) {
      release(config, services.visualEvents);
    },
  };
}
