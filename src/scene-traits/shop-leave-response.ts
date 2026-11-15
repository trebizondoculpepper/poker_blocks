/**
 * shopExitResponse (#880; doc/outcome-presentation.md, "Effect and progression sounds"): a
 * controller trait that presents the committed `shop.left` receipt on the shared scheduler. On
 * the receipt it starts the outgoing stock's burn and, only when something left, plays its burn
 * cue; a scheduled `shop.burnOutgoing` effect then advances the burn on the presentation clock.
 * When that scope finishes, the leave cue plays at the exit anchor. Leaving the scene cancels the
 * scope, so a cut-short burn plays no stale cue. It never decides or delays the leave itself.
 */
import type { SoundEffectId } from "../audio/sfx-registry";
import type { EventEnvelope } from "../lifecycle/action";
import type { GameEvent } from "../passives";
import type { SceneTraitBehaviour } from "../scenes";
import {
  unitMs,
  visualHandlers,
  type Admission,
  type EffectHandle,
  type EventDescription,
  type ScopeHandle,
  type ScopeStatus,
} from "../visual-events/scheduler";

export type ShopExitResponseConfig = { burnSound: SoundEffectId; leaveSound: SoundEffectId };

/** What the scheduled burn handler reaches through the scheduler's services. */
export type ShopBurnServices = { shopBurn: { effect(): EffectHandle } };

export const shopBurnHandler = "shop.burnOutgoing";
visualHandlers.register(shopBurnHandler, (_payload, context) =>
  (context.services as ShopBurnServices).shopBurn.effect(),
);

export type ShopExitScheduler = {
  readonly nowMs: number;
  createScope(parent: ScopeHandle | null): ScopeHandle;
  schedule(scope: ScopeHandle, description: EventDescription): Admission;
  seal(scope: ScopeHandle): boolean;
  observe(scope: ScopeHandle, listener: (status: ScopeStatus) => void): () => void;
  cancel(target: ScopeHandle): void;
};

export function shopExitResponse<
  Context extends {
    services: {
      run: {
        onCommitted(listener: (facts: readonly EventEnvelope[]) => void): () => void;
        readonly reducedMotion: boolean;
      };
      shop: { startBurn(reducedMotion: boolean): void; finishBurn(): void };
      visualEvents: ShopExitScheduler;
      sound(id: SoundEffectId): void;
    };
  },
>(): SceneTraitBehaviour<Context, ShopExitResponseConfig> {
  const live = new WeakMap<object, { stop(): void; scopes: Set<ScopeHandle> }>();
  const release = (config: object, visualEvents: ShopExitScheduler) => {
    const held = live.get(config);
    if (!held) return;
    held.stop();
    // Cut short: cancelled scopes never report finished, so no stale leave cue plays.
    for (const scope of held.scopes) visualEvents.cancel(scope);
    live.delete(config);
  };
  return {
    enter({ services }, config) {
      release(config, services.visualEvents);
      const scopes = new Set<ScopeHandle>();
      const stop = services.run.onCommitted((facts) => {
        for (const { payload } of facts) {
          const { outgoingStock } = payload as GameEvent;
          if (!outgoingStock) continue;
          const { visualEvents } = services;
          // The shop still shows exactly the receipt's stock: start its burn now, so the run
          // waiting on it sees it begun, and cue it only if anything actually left.
          services.shop.startBurn(services.run.reducedMotion);
          if (outgoingStock.length) services.sound(config.burnSound);
          const scope = visualEvents.createScope(null);
          scopes.add(scope);
          visualEvents.observe(scope, ({ state }) => {
            if (state === "pending") return;
            scopes.delete(scope);
            if (state === "finished") services.sound(config.leaveSound);
          });
          const admitted = visualEvents.schedule(scope, {
            handler: shopBurnHandler,
            dueUnits: visualEvents.nowMs / unitMs,
          });
          if (!admitted.accepted) {
            // Overloaded: settle the burn at once and cue the leave as its summary, so the run
            // is never left waiting on an effect nothing will advance.
            scopes.delete(scope);
            visualEvents.cancel(scope);
            services.shop.finishBurn();
            services.sound(config.leaveSound);
            continue;
          }
          visualEvents.seal(scope);
        }
      });
      live.set(config, { stop, scopes });
    },
    exit({ services }, config) {
      release(config, services.visualEvents);
    },
  };
}
