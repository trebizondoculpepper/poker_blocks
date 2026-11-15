/**
 * What a rack item does when it is dropped on a card (#389): a registry of effects keyed by the
 * item's trait name. Applying an item runs the effect of each trait it has that registers one;
 * nothing here asks what kind of item it is. A transmogrifier's `transmogrifier` trait changes
 * the card's material (#387). An effect returns the new state, or null to refuse (nothing
 * changes and no use is spent).
 */
import { Registry } from "./core/registry";
import { changeMaterialCommitted } from "./card-material";
import type { GameState } from "./game-state";
import type { GameEvent, PassiveBlock } from "./passives";

/** An effect's outcome: the new state, or that and the facts it committed (#539); null refuses. */
export type RackItemEffect = (
  state: GameState,
  item: PassiveBlock,
  cardId: string,
) => GameState | { state: GameState; events: readonly GameEvent[] } | null;

export const rackItemEffects = new Registry<RackItemEffect>("rack item effect");

rackItemEffects.register("transmogrifier", (state, item, cardId) =>
  changeMaterialCommitted(state, cardId, item.traits.transmogrifier!.material),
);

/**
 * What happens to a rack item after it is used, keyed by trait name: the item as it is now, or
 * null when it is used up and leaves the rack. `limitedUse` wears it down by one use. An item
 * whose traits register no hook is unchanged by use.
 */
export type RackItemUseHook = (item: PassiveBlock) => PassiveBlock | null;
export const rackItemUseHooks = new Registry<RackItemUseHook>("rack item use hook");

rackItemUseHooks.register("limitedUse", (item) => {
  const { uses, total } = item.traits.limitedUse!;
  return uses > 1
    ? { ...item, traits: { ...item.traits, limitedUse: { uses: uses - 1, total } } }
    : null;
});

/** The registered handlers for each of an item's traits that has one. */
const handlersFor = <T>(item: PassiveBlock, registry: Registry<T>): T[] =>
  Object.keys(item.traits).flatMap((trait) => (registry.has(trait) ? [registry.get(trait)] : []));

/**
 * Apply a rack item to a card: its effects, then each of its traits' use hooks (one use spent;
 * used up, it leaves the rack for good). Null when the item isn't in the rack, has no effect on
 * cards, or every effect refuses.
 */
export function applyRackItem(state: GameState, itemId: string, cardId: string): GameState | null {
  return useRackItem(state, itemId, cardId)?.state ?? null;
}

/** Apply a rack item to a card, with the facts its effects committed (#539). */
export function useRackItem(
  state: GameState,
  itemId: string,
  cardId: string,
): { state: GameState; events: GameEvent[] } | null {
  const item = state.passiveRack.find(({ id }) => id === itemId);
  if (!item) return null;
  const effects = handlersFor(item, rackItemEffects);
  if (!effects.length) return null;
  let next: GameState | null = state;
  const events: GameEvent[] = [];
  for (const effect of effects) {
    if (!next) break;
    const outcome = effect(next, item, cardId);
    if (outcome && "events" in outcome) {
      next = outcome.state;
      events.push(...outcome.events);
    } else next = outcome;
  }
  if (!next) return null;
  const used = handlersFor(item, rackItemUseHooks).reduce<PassiveBlock | null>(
    (current, hook) => current && hook(current),
    item,
  );
  return {
    state: {
      ...next,
      passiveRack: next.passiveRack.flatMap((held) =>
        held.id === itemId ? [used ?? []].flat() : [held],
      ),
    },
    events,
  };
}
