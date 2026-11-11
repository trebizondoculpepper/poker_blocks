/**
 * What a rack item does when it is dropped on a card (#389): a registry of effects keyed by the
 * item's trait name. Applying an item runs the effect of each trait it has that registers one;
 * nothing here asks what kind of item it is. A transmogrifier's `transmogrifier` trait changes
 * the card's material (#387). An effect returns the new state, or null to refuse (nothing
 * changes and no use is spent).
 */
import { Registry } from "./core/registry";
import { changeCardMaterial } from "./card-material";
import type { GameState } from "./game-state";
import type { PassiveBlock } from "./passives";

export type RackItemEffect = (
  state: GameState,
  item: PassiveBlock,
  cardId: string,
) => GameState | null;

export const rackItemEffects = new Registry<RackItemEffect>("rack item effect");

rackItemEffects.register("transmogrifier", (state, item, cardId) =>
  changeCardMaterial(state, cardId, item.traits.transmogrifier!.material),
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
  const item = state.passiveRack.find(({ id }) => id === itemId);
  if (!item) return null;
  const effects = handlersFor(item, rackItemEffects);
  if (!effects.length) return null;
  let next: GameState | null = state;
  for (const effect of effects) next = next && effect(next, item, cardId);
  if (!next) return null;
  const used = handlersFor(item, rackItemUseHooks).reduce<PassiveBlock | null>(
    (current, hook) => current && hook(current),
    item,
  );
  return {
    ...next,
    passiveRack: next.passiveRack.flatMap((held) =>
      held.id === itemId ? [used ?? []].flat() : [held],
    ),
  };
}
