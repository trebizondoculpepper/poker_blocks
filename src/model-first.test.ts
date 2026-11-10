import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { queueScoreSteps } from "./play-presenter";

const timing = { lineStepMs: 300, settleMs: 500 };

describe("model first (#272)", () => {
  it("queues a later play's scoring behind lines still waiting, one step apart", () => {
    const first = queueScoreSteps([], null, ["a", "b"], 1000, timing);
    expect(first.steps.map(({ at, line }) => [at, line])).toEqual([
      [1000, "a"],
      [1300, "b"],
    ]);
    expect(first.outcomeAt).toBe(1800);
    // A second play lands at 1100, while "b" is still waiting.
    const second = queueScoreSteps(first.steps, first.outcomeAt, ["c"], 1100, timing);
    expect(second.steps.map(({ at, line }) => [at, line])).toEqual([
      [1000, "a"],
      [1300, "b"],
      [1600, "c"],
    ]);
    expect(second.outcomeAt).toBe(2100);
  });

  it("starts at once when nothing is waiting, and a play that scores nothing settles now", () => {
    expect(queueScoreSteps([], null, ["a"], 5000, timing).steps).toEqual([{ at: 5000, line: "a" }]);
    expect(queueScoreSteps([], null, [], 5000, timing).outcomeAt).toBe(5000);
  });

  it("never holds input back for an animation", () => {
    const input = readFileSync(new URL("./table-input.ts", import.meta.url), "utf8");
    // The held-drop machinery is gone: drops and discards commit at once.
    expect(input).not.toMatch(/pendingDrop|drop held|discard ignored", "an animation/);
    const run = readFileSync(new URL("./run-controller.ts", import.meta.url), "utf8");
    expect(run).not.toMatch(
      /canSellPassives: \(\) => game\.canSellPassives && !services\.presenter\.busy/,
    );
  });
});
