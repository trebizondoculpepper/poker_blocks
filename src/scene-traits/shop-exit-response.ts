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
      shop: { burnUnsold(reducedMotion: boolean, ids?: readonly string[]): Promise<void> };
      sound(id: SoundEffectId): void;
    };
  },
>(): SceneTraitBehaviour<Context, ShopExitResponseConfig> {
  const stops = new WeakMap<object, () => void>();
  return {
    enter({ services }, config) {
      stops.get(config)?.();
      stops.set(
        config,
        services.run.onCommitted((facts) => {
          for (const { payload } of facts) {
            const { outgoingStock } = payload as GameEvent;
            if (!outgoingStock) continue;
            const ids = outgoingStock.map(({ blockId }) => blockId);
            if (ids.length) services.sound(config.burnSound);
            void services.shop
              .burnUnsold(services.run.reducedMotion, ids)
              .then(() => services.sound(config.leaveSound));
          }
        }),
      );
    },
    exit(_context, config) {
      stops.get(config)?.();
      stops.delete(config);
    },
  };
}
