import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { standardDeck } from "./cards";
import { deckRankOrder, groupDeckByRank } from "./deck-view";
import { makeDevDeck } from "./materials";

describe("deck view (#175)", () => {
  it("lists every block, in rank order 2 to Ace, variants grouped by rank", () => {
    const deck = makeDevDeck(7).slice(0, 40);
    const groups = groupDeckByRank(deck);
    expect(groups.flatMap(({ blocks }) => blocks)).toHaveLength(deck.length);
    expect(groups.map(({ rank }) => rank)).toEqual(
      deckRankOrder.filter((rank) => deck.some((b) => b.traits.identity!.rank === rank)),
    );
    expect(deckRankOrder[0]).toBe("2");
    expect(deckRankOrder.at(-1)).toBe("A");
    for (const { rank, blocks } of groups)
      for (const block of blocks) expect(block.traits.identity!.rank).toBe(rank);
  });

  it("is read-only: it never changes the deck it is given", () => {
    const deck = [...standardDeck];
    groupDeckByRank(deck);
    expect(deck).toEqual(standardDeck);
    const source = readFileSync(new URL("./deck-view.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\.(splice|push|pop|shift|sort)\(/);
  });
});
