/**
 * committedEventSounds (#755): a presentation controller trait that plays the sound each committed
 * fact names, for plays and discards alike. The model records which sound an outcome has (a rule's
 * configured `sound`); this trait only presents it, once the action has committed. Nothing is
 * inferred from comparing state, and the sound service never learns what asked
 * (doc/game-architecture.md, "Services and controller traits (#537)").
 */
import type { SoundEffectId } from "../audio/sfx-registry";
import type { GameEvent } from "../passives";
import type { EventEnvelope } from "../lifecycle/action";
import type { SceneTraitBehaviour } from "../scenes";

export type CommittedEventSoundsConfig = Record<never, never>;

/**
 * The sounds a set of committed events names, each once, in first-named order: two passives
 * paying coins in one discard play the coin sound once, as before (#566 review).
 */
export function committedSounds(events: readonly GameEvent[]): SoundEffectId[] {
  return [...new Set(events.flatMap(({ sound }) => (sound ? [sound] : [])))];
}

export function committedEventSounds<
  Context extends {
    services: {
      run: {
        onCommitted(listener: (facts: readonly EventEnvelope[]) => void): () => void;
      };
      sound(id: SoundEffectId): void;
    };
  },
>(): SceneTraitBehaviour<Context, CommittedEventSoundsConfig> {
  let stop: (() => void) | null = null;
  return {
    enter({ services }) {
      stop?.();
      stop = services.run.onCommitted((facts) => {
        const events = facts.map(({ payload }) => payload as GameEvent);
        for (const sound of committedSounds(events)) services.sound(sound);
      });
    },
    exit() {
      stop?.();
      stop = null;
    },
  };
}
