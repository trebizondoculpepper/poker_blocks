/**
 * The run's card inventory (#472; doc/ordered-card-ownership.md, "Run inventory is a query"): a
 * pure query over the authoritative zones, never a second catalogue. Each zone is registered
 * with how it reads its own cards and how it is described, so nothing here names a zone. Every
 * live card appears exactly once with its current material and state; a removed card is in no
 * zone and so in no inventory. Duplicates of a rank and suit stay separate instances.
 */
import type { CardBlock } from "./cards";
import { Registry } from "./core/registry";
import type { GameState } from "./game-state";

export type InventoryZone = {
  /** Where a card in this zone is, in words, for its accessible label. */
  label: string;
  /** A short readable marker for the zone. */
  icon: string;
  cards(state: GameState): readonly CardBlock[];
};

export const inventoryZones = new Registry<InventoryZone>("inventory zone");
inventoryZones.register("deck", { label: "in the deck", icon: "▤", cards: (state) => state.deck });
inventoryZones.register("hand", {
  label: "in your hand",
  icon: "✋",
  cards: (state) => state.hand,
});
inventoryZones.register("field", {
  label: "on the table",
  icon: "▦",
  cards: (state) => state.field.map(({ block }) => block),
});
inventoryZones.register("discard", {
  label: "in the discard pile",
  icon: "⤓",
  cards: (state) => state.discardPile,
});

export type InventoryRecord = Readonly<{
  card: CardBlock;
  /** Its zone's registered name, label and marker. */
  zone: string;
  label: string;
  icon: string;
  /** Its place in that zone's own order. */
  order: number;
}>;

/** Every live card in the run, zone by zone in registration order, each zone in its own order. */
export function runInventory(state: GameState): InventoryRecord[] {
  return inventoryZones.names().flatMap((zone) => {
    const described = inventoryZones.get(zone);
    const { label, icon } = described;
    return described.cards(state).map((card, order) => ({ card, zone, label, icon, order }));
  });
}
