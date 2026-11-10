/**
 * The in-run deck view (#175): a read-only overlay listing every block in the run's deck,
 * in rank order from 2 to Ace, with each rank's suit and material variants grouped under it.
 * Hover, focus or tap on a block shows its details. It never changes the deck.
 */
import { ranks, type CardBlock } from "./cards";
import { getMaterialDefinition, materialOf } from "./materials";

export type DeckView = {
  /** Show these blocks; `close` is called by the Back button. */
  show(blocks: readonly CardBlock[], close: () => void): void;
  hide(): void;
};

/** Display order: 2 to 10, the court cards, then the Ace. */
export const deckRankOrder = [...ranks.slice(1), ranks[0]];

/** The deck grouped by rank, in display order; empty ranks are left out. */
export function groupDeckByRank(
  blocks: readonly CardBlock[],
): { rank: string; blocks: CardBlock[] }[] {
  return deckRankOrder
    .map((rank) => ({
      rank,
      blocks: blocks.filter((block) => block.traits.identity.rank === rank),
    }))
    .filter(({ blocks: group }) => group.length > 0);
}

/** What a block shows when inspected: the same details as hovering it in play. */
export function deckBlockDetails(block: CardBlock): string {
  return (
    block.traits.inspectable?.inspect() ??
    `${block.traits.identity.rank}${block.traits.identity.suit.symbol} · ${getMaterialDefinition(materialOf(block)).name}`
  );
}

export function createDeckView(host: HTMLElement): DeckView {
  const root = document.createElement("div");
  root.className = "deck-view";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Your deck");
  root.hidden = true;
  host.append(root);

  return {
    show(blocks, close) {
      const heading = document.createElement("h2");
      heading.className = "deck-view-heading";
      heading.textContent = `YOUR DECK · ${blocks.length}`;
      const details = document.createElement("p");
      details.className = "deck-view-details";
      details.setAttribute("aria-live", "polite");
      details.textContent = "Hover or tap a block to see it.";
      const list = document.createElement("div");
      list.className = "deck-view-ranks";
      for (const group of groupDeckByRank(blocks)) {
        const row = document.createElement("div");
        row.className = "deck-view-rank";
        const label = document.createElement("span");
        label.className = "deck-view-rank-label";
        label.textContent = group.rank;
        row.append(label);
        for (const block of group.blocks) {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "deck-view-block";
          const { rank, suit } = block.traits.identity;
          chip.textContent = `${rank}${suit.symbol}`;
          chip.style.color = suit.color;
          chip.dataset.material = materialOf(block);
          const text = deckBlockDetails(block);
          chip.setAttribute("aria-label", text);
          const reveal = () => (details.textContent = text);
          chip.addEventListener("pointerenter", reveal);
          chip.addEventListener("focus", reveal);
          chip.addEventListener("click", reveal);
          row.append(chip);
        }
        list.append(row);
      }
      const back = document.createElement("button");
      back.type = "button";
      back.className = "deck-view-back";
      back.textContent = "Back";
      back.addEventListener("click", close);
      root.replaceChildren(heading, details, list, back);
      root.hidden = false;
      back.focus();
    },
    hide() {
      root.hidden = true;
      root.replaceChildren();
    },
  };
}
