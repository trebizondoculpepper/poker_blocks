/**
 * shopExitResponse (#880; doc/outcome-presentation.md, "Effect and progression sounds"): a
 * controller trait that presents the committed `shop.left` receipt. It burns exactly the
 * outgoing stock the receipt captured, plays its burn cue as the burn starts (only when
 * something left), and its leave cue at the exit anchor, once the burn is done. It never
 * decides or delays the leave: the model has already committed it.
 */
import type { SoundEffectId } from "../audio/sfx-registry";
import type { EventEnvelope } from "../lifecycle/action";
import type { GameEvent } from "../passives";
import type { SceneTraitBehaviour } from "../scenes";

export type ShopExitResponseConfig = { burnSound: SoundEffectId; leaveSound: SoundEffectId };

export function shopExitResponse<
  Context extends {
    services: {
      run: {
        onCommitted(listener: (facts: readonly EventEnvelope[]) => void): () => void;
        readonly reducedMotion: boolean;
      };
      shop: { burnUnsold(reducedMotion: boolean): Promise<void> };
      sound(id: SoundEffectId): void;
    };
  },
>(): SceneTraitBehaviour<Context, ShopExitResponseConfig> {
  const stops = new WeakMap<object, () => void>();
  /**
   * The response lease (doc/outcome-presentation.md, stale-response cancellation): each entry
   * or exit starts a new generation, and a completion cue plays only for the one it began in.
   */
  let generation = 0;
  return {
    enter({ services }, config) {
      stops.get(config)?.();
      generation += 1;
      const lease = generation;
      stops.set(
        config,
        services.run.onCommitted((facts) => {
          for (const { payload } of facts) {
            const { outgoingStock } = payload as GameEvent;
            if (!outgoingStock) continue;
            // The shop still shows exactly the stock the receipt captured: nothing can change
            // it between the commit and here.
            if (outgoingStock.length) services.sound(config.burnSound);
            void services.shop.burnUnsold(services.run.reducedMotion).then(() => {
              // Exited (a new run, a quit) before the burn finished: a stale cue plays nothing.
              if (lease === generation) services.sound(config.leaveSound);
            });
          }
        }),
      );
    },
    exit(_context, config) {
      generation += 1;
      stops.get(config)?.();
      stops.delete(config);
    },
  };
}
