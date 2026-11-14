import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

describe("model first (#272)", () => {
  it("never holds input back for an animation", () => {
    const input = readFileSync(new URL("./table-input.ts", import.meta.url), "utf8");
    // The held-drop machinery is gone: drops and discards commit at once.
    expect(input).not.toMatch(/pendingDrop|drop held|discard ignored", "an animation/);
    const run = readFileSync(new URL("./game-run-controller.ts", import.meta.url), "utf8");
    expect(run).not.toMatch(
      /canSellPassives: \(\) => game\.canSellPassives && !services\.presenter\.busy/,
    );
  });
});
