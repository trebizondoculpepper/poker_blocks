import { inspectBlock } from "./traits/inspectable";
/**
 * The in-run card view (#175, #472): a read-only overlay listing the run's cards in rank order
 * from 2 to Ace, each rank's suit and material variants grouped under it, each with a marker
 * saying where it is (deck, hand, table or discard). Hover, focus or tap on a block shows its
 * details and location. It never changes the run.
 */
import { ranks, type CardBlock } from "./cards";
import { getMaterialDefinition, materialOf } from "./materials";

/** Where a listed card is: its marker and its description. */
export type CardLocation = { icon: string; label: string };

export type DeckView = {
  /**
   * Show these blocks, each with where it is if `locationOf` says; `close` is called by the
   * Back button.
   */
  show(
    blocks: readonly CardBlock[],
    close: () => void,
    locationOf?: (block: CardBlock) => CardLocation | undefined,
  ): void;
  hide(): void;
  /** Showing: a stage's outcome waits until it closes (#175). */
  readonly isOpen: boolean;
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
    inspectBlock(block) ??
    `${block.traits.identity.rank}${block.traits.identity.suit.symbol} · ${getMaterialDefinition(materialOf(block)).name}`
  );
}

export function createDeckView(host: HTMLElement): DeckView {
  const root = document.createElement("div");
  root.className = "deck-view";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Your cards");
  root.hidden = true;
  host.append(root);

  return {
    show(blocks, close, locationOf = () => undefined) {
      const heading = document.createElement("h2");
      heading.className = "deck-view-heading";
      heading.textContent = `YOUR CARDS · ${blocks.length}`;
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
          const location = locationOf(block);
          if (location) {
            const marker = document.createElement("span");
            marker.className = "deck-view-location";
            marker.textContent = location.icon;
            marker.setAttribute("aria-hidden", "true");
            chip.append(marker);
          }
          chip.style.color = suit.color;
          chip.dataset.material = materialOf(block);
          const text = location
            ? `${deckBlockDetails(block)}\n${location.label[0]!.toUpperCase()}${location.label.slice(1)}`
            : deckBlockDetails(block);
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
    get isOpen() {
      return !root.hidden;
    },
  };
}
