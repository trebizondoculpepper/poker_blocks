import { describe, expect, it } from "vite-plus/test";
import { blockChip, blockFaceArt, blockName } from "./block-presentation";
import { cardName, standardDeck } from "./cards";
import { groupDeckByRank, ranklessGroup, deckBlockDetails } from "./deck-view";
import { devRanklessActive } from "./dev-rankless-active";
import { cardFaceArt } from "./visual/face-art";
import { getMaterialDefinition, withMaterial } from "./materials";

describe("rankless presentation providers (#893)", () => {
  const ace = standardDeck[0]!;
  const rankless = devRanklessActive("dev-rankless-1");

  it("names, labels and paints an ordinary card exactly as before", () => {
    expect(blockName(ace)).toBe(cardName(ace.traits.identity!));
    expect(blockChip(ace)).toEqual({ text: "A♠", color: ace.traits.identity!.suit.color });
    expect(blockFaceArt(ace).seed).toBe(cardFaceArt(ace.traits.identity!).seed);
  });

  it("names a rankless active by its own label, with a blank face and no rank or suit", () => {
    expect(blockName(rankless)).toBe("Dev rankless active");
    expect(blockChip(rankless)).toEqual({ text: "◇" });
    const art = blockFaceArt(rankless);
    expect(art.seed).toBe("dev-rankless-1");
    let painted = false;
    art.paint({ fillText: () => (painted = true) } as never, () => "#000");
    expect(painted).toBe(false);
  });

  it("keeps its label when a material is applied", () => {
    const steel = withMaterial(rankless, getMaterialDefinition("steel"));
    expect(blockName(steel)).toBe("Dev rankless active");
    expect(steel.traits.inspectable?.inspect()).toMatch(/^Dev rankless active · /);
  });

  it("lists a rankless active in the deck view's last group, not under a rank", () => {
    const groups = groupDeckByRank([ace, rankless, standardDeck[1]!]);
    expect(groups.at(-1)).toEqual({ rank: ranklessGroup, blocks: [rankless] });
    expect(groups.flatMap(({ blocks }) => blocks)).toHaveLength(3);
    expect(deckBlockDetails(rankless)).toMatch(/Dev rankless active/);
  });
});

describe("face-art providers registered later (#893 review)", () => {
  it("answer before the blank fallback", async () => {
    const { blockFaceArtProviders } = await import("./block-presentation");
    blockFaceArtProviders.register("test-rankless-art", (block) =>
      block.id === "art-test" ? { seed: "custom", paint: () => {} } : undefined,
    );
    expect(blockFaceArt(devRanklessActive("art-test")).seed).toBe("custom");
    expect(blockFaceArt(devRanklessActive("other")).seed).toBe("other");
  });
});
