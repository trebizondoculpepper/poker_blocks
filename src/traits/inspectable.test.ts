import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "../cards";
import { inspectBlock } from "./inspectable";

describe("inspectable trait", () => {
  it("describes standard cards on hover", () => {
    expect(standardDeck[0].traits.inspectable?.inspect()).toBe("Ace of Spades");
    expect(inspectBlock(standardDeck[0])).toBe("Ace of Spades");
    expect(inspectBlock(standardDeck[14])).toBe("2 of Hearts");
  });

  it("does not inspect a block without the trait", () => {
    const block = standardDeck[0];
    expect(inspectBlock({ ...block, traits: { identity: block.traits.identity } })).toBeNull();
  });
});
