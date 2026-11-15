import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { deckRows, runStatusTabs, statusNotBuilt } from "./run-status-scene";
import type { InventoryRecord } from "./run-inventory";
import type { CardBlock } from "./cards";

/** An inventory record for `card` in `zone`, as `runInventory` builds one. */
const record = (card: CardBlock, zone = "hand", order = 0): InventoryRecord => ({
  card,
  zone,
  label: `in the ${zone}`,
  icon: "•",
  order,
});

describe("run-status tabs (#1378)", () => {
  it("shows Deck first, as the owner decided, then Status", () => {
    const tabs = runStatusTabs({ inventory: () => [], onCommitted: () => () => {} });
    expect(tabs.map(({ label }) => label)).toEqual(["Deck", "Status"]);
  });

  it("keeps a tab whose content is not built yet, saying so rather than vanishing", () => {
    const [, status] = runStatusTabs({ inventory: () => [], onCommitted: () => () => {} });
    const content = status!.provider.content();
    expect(content.rows).toEqual([]);
    expect(content.unavailable).toBe(statusNotBuilt);
  });
});

describe("deck rows (#1378)", () => {
  it("lists every live card once, in display order, each described by its own inspection", () => {
    const two = standardDeck.find(({ traits }) => traits.identity?.rank === "2")!;
    const ace = standardDeck.find(({ traits }) => traits.identity?.rank === "A")!;
    // Listed ace first, two second: the display order puts the 2 before the ace.
    const rows = deckRows([record(two, "hand"), record(ace, "deck")]);
    expect(rows).toHaveLength(2);
    expect(rows.map(({ ref }) => ref)).toEqual([two.id, ace.id]);
    // Each says where it is, and its row carries the instance id a redraw keys on.
    expect(rows[0]!.inspect).toContain("In the hand");
    expect(rows[1]!.inspect).toContain("In the deck");
  });

  it("keeps same-rank duplicates as separate entries", () => {
    const [card] = standardDeck;
    const rows = deckRows([record(card!, "deck"), record(card!, "discard", 1)]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.ref).toBe(rows[1]!.ref);
  });

  it("shows an empty deck as no entries at all", () => {
    expect(deckRows([])).toEqual([]);
  });

  it("clears the run's subscription when the panel closes", () => {
    let released = false;
    const tabs = runStatusTabs({
      inventory: () => [],
      onCommitted: () => () => {
        released = true;
      },
    });
    const release = tabs[0]!.provider.watch!(() => undefined);
    release();
    expect(released).toBe(true);
  });
});
