/**
 * The run-status panel's scene adapter and its two initial tab providers (#1378; doc/run-status.md,
 * "Host, providers and lifecycle" and "Focused delivery and verification").
 *
 * The scene composes the shared tab host through its existing `deckView` trait, keeping that
 * trait's navigation, Back dispatch and `pausesBelow` policy exactly as they were: only what the
 * panel shows underneath changes. This module supplies one narrow read-only provider per approved
 * tab, each over a query the run already publishes.
 *
 * - **Deck.** `run.inventory()` is the authoritative query over the run's zones (every live card
 *   with the zone it is in), reused as it is: this projection only orders and describes, and adds
 *   no second inventory.
 * - **Status.** A placeholder in this delivery, and deliberately visible as one: #1380 owns the
 *   round/stage/score and the installed rack items, which need owner descriptors this adapter does
 *   not yet have. Saying so is better than guessing at them here.
 * - **Deepening belongs to its own tab.** #1379 (Deck) and #1380 (Status) own the rest of the
 *   contract in `doc/run-status.md`: visible material names, complete inspection, rack order and
 *   counters, and the empty state. They build on a host that already works rather than replacing it.
 * - **No polling.** A provider's `watch` is the run's committed-state channel, which is already
 *   published; re-entry rebuilds from the owner's queries.
 */
import type { CardBlock } from "./cards";
import { deckBlockDetails, groupDeckByRank } from "./deck-view";
import type { InventoryRecord } from "./run-inventory";
import type { StatusProvider, StatusTab } from "./status-host";

/** What the scene adapter may ask the run for: published queries only, nothing mutable. */
export type RunStatusSource = {
  /** Every live card in the run and where it is (#472). */
  inventory(): readonly InventoryRecord[];
  /** The committed-state channel: called when a committed action changes the run. */
  onCommitted(listener: () => void): () => void;
};

/**
 * One entry per live card, in the shared display order: the rank groups `groupDeckByRank` builds,
 * and each group's cards in the order the inventory gave them. A redraw is keyed by the card's own
 * instance, so duplicates stay separate and the player keeps their place.
 */
export function deckRows(records: readonly InventoryRecord[]): {
  text: string;
  inspect: string;
  ref: string;
}[] {
  const where = new Map(records.map(({ card, label }) => [card, label]));
  return groupDeckByRank(records.map(({ card }) => card)).flatMap(({ blocks }) =>
    blocks.map((card: CardBlock) => {
      const details = deckBlockDetails(card);
      const location = where.get(card);
      return {
        // The first line is the card's short label; the rest is its description.
        text: details.split("\n")[0] || details,
        inspect: location ? `${details}\n${capitalise(location)}` : details,
        ref: card.id,
      };
    }),
  );
}

const capitalise = (text: string) => `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;

/** The Deck tab's provider: the run's live cards, each described as it is in play. */
export function deckProvider(run: RunStatusSource): StatusProvider {
  return {
    content() {
      const records = run.inventory();
      return {
        title: `Your cards · ${records.length}`,
        summary:
          records.length === 0
            ? "No cards are in play."
            : "Every card in play, with where it is. Focus or tap a card to see it.",
        rows: deckRows(records),
      };
    },
    watch: (changed) => run.onCommitted(changed),
  };
}

/** What a tab of this delivery says while its own focused ticket builds the content (#1380). */
export const statusNotBuilt = "This tab's content is not built yet (#1380).";

/** The Status tab's provider: a declared gap, shown as one rather than guessed at (#1380). */
export function statusProvider(): StatusProvider {
  return {
    content: () => ({
      title: "Gameplay status",
      summary: "The round, the stage score and the installed items appear here.",
      rows: [],
      unavailable: statusNotBuilt,
    }),
  };
}

/**
 * The tabs the run status shows, in order, with Deck selected first as the owner decided. A tab
 * whose content is not built still appears and says so, rather than silently going missing.
 */
export function runStatusTabs(run: RunStatusSource): StatusTab[] {
  return [
    { id: "deck", label: "Deck", provider: deckProvider(run) },
    { id: "gameplay", label: "Status", provider: statusProvider() },
  ];
}
