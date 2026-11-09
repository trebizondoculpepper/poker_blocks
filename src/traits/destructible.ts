/**
 * A block that can be destroyed, and by what. Destruction removes the block from the field
 * and leaves a gap: nothing settles into it (settling will be a trait of its own). The
 * rule lives in GameSession.destroyBlock; what causes a destruction (a double-click in a
 * test room, later melting or bombs) is a separate trait that names its cause.
 */
import { cardName, type CardBlock } from "../cards";
import { inspectBlock, inspectable } from "./inspectable";

/** What can destroy a block. "manual" is the testing room's double-click. */
export type DestroyCause = "manual";

export type DestructibleTrait = { by: readonly DestroyCause[] };

/** Whether `cause` may destroy this block. A block without the trait cannot be destroyed. */
export function canDestroy(block: CardBlock, cause: DestroyCause): boolean {
  return block.traits.destructible?.by.includes(cause) ?? false;
}

/** Dev room configuration (testing only): which share of a deck is destructible, and by what. */
export type DevDestructibleMix = { share: number; by: readonly DestroyCause[] };

/** A stable number in [0, 1) for a card id, so the mix survives a reload without a seed. */
function idFraction(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

/**
 * Make about `share` of the deck destructible (always the same cards), and say so in their
 * descriptions. With no mix, or a share of 0, the deck is unchanged.
 */
export function withDevDestructibleMix(
  deck: readonly CardBlock[],
  mix: DevDestructibleMix = { share: 0, by: [] },
): readonly CardBlock[] {
  return deck.map(
    (card) =>
      [card]
        .filter(() => idFraction(card.id) < mix.share)
        .map((chosen): CardBlock => ({
          ...chosen,
          traits: {
            ...chosen.traits,
            destructible: { by: mix.by },
            inspectable: inspectable(
              `${inspectBlock(chosen) ?? cardName(chosen.traits.identity)} · Destructible`,
            ),
          },
        }))
        .concat(card)[0],
  );
}
