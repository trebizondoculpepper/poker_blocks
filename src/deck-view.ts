/**
 * How the run's cards are listed in the status panel's Deck tab (#175, #472, #1379): grouped in
 * shared display order, each card described by the same inspection as in play. The panel itself is
 * the shared tab host (`src/status-host.ts`); nothing here draws.
 */
import { inspectBlock } from "./traits/inspectable";
import { ranks, type CardBlock } from "./cards";
import { blockChip } from "./block-presentation";
import { getMaterialDefinition, materialOf } from "./materials";

/** Display order: 2 to 10, the court cards, then the Ace. */
export const deckRankOrder = [...ranks.slice(1), ranks[0]];

/** The label of the group for blocks with no rank (rankless actives, #893), listed last. */
export const ranklessGroup = "Other";

/**
 * The deck grouped by rank, in display order; empty ranks are left out. A block with no rank/suit
 * value provider joins the last group rather than being given a rank.
 */
export function groupDeckByRank(
  blocks: readonly CardBlock[],
): { rank: string; blocks: CardBlock[] }[] {
  return [...deckRankOrder, ranklessGroup]
    .map((rank) => ({
      rank,
      blocks: blocks.filter((block) => (block.traits.identity?.rank ?? ranklessGroup) === rank),
    }))
    .filter(({ blocks: group }) => group.length > 0);
}

/** What a block shows when inspected: the same details as hovering it in play. */
export function deckBlockDetails(block: CardBlock): string {
  return (
    inspectBlock(block) ??
    `${blockChip(block).text} · ${getMaterialDefinition(materialOf(block)).name}`
  );
}
