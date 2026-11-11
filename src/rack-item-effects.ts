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
 * Apply a rack item to a card: its effects, then one use spent (an item with no uses left
 * leaves the rack for good). Null when the item isn't in the rack, has no effect on cards, or
 * every effect refuses.
 */
export function applyRackItem(state: GameState, itemId: string, cardId: string): GameState | null {
  const item = state.passiveRack.find(({ id }) => id === itemId);
  if (!item) return null;
  const effects = Object.keys(item.traits).flatMap((trait) =>
    rackItemEffects.has(trait) ? [rackItemEffects.get(trait)] : [],
  );
  if (!effects.length) return null;
  let next: GameState | null = state;
  for (const effect of effects) next = next && effect(next, item, cardId);
  if (!next) return null;
  const limited = item.traits.limitedUse;
  const left = limited ? limited.uses - 1 : 1;
  return {
    ...next,
    passiveRack: next.passiveRack.flatMap((held) =>
      held.id !== itemId
        ? [held]
        : left > 0
          ? [
              {
                ...held,
                traits: {
                  ...held.traits,
                  ...(limited ? { limitedUse: { ...limited, uses: left } } : {}),
                },
              },
            ]
          : [],
    ),
  };
}
