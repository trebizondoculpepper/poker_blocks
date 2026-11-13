import { describe, expect, it } from "vite-plus/test";
import {
  activationDescriptors,
  describeActivation,
  describePassiveActivation,
  formatNumber,
} from "./activation-descriptor";
import type { ResolvedOutcome } from "./event-rules";
import type { RuleActivation } from "./passive-effects";

const activation = (...outcomes: ResolvedOutcome[]): RuleActivation => ({
  sourceId: "passive.1",
  sourceDescription: "D6",
  on: "score.beforeLineFinalized",
  commands: [],
  outcomes,
});

describe("activation descriptor (#484)", () => {
  it("describes resolved values, not recipes: a die's roll, Crossroads' effective bonus", () => {
    expect(
      describeActivation(
        activation({ operation: "add-line-score", operand: 6, before: 10, after: 16 }),
      ),
    ).toBe("+6");
    expect(describeActivation(activation({ operation: "add-line-score", operand: 9 }))).toBe("+9");
  });

  it("writes one line per effective operation, in order, with units", () => {
    expect(
      describeActivation(
        activation(
          { operation: "multiply-line-score", operand: 2 },
          { operation: "power-line-score", operand: 1.2 },
          { operation: "add-coins", operand: 2, unit: "coins" },
          { operation: "add-coins.committed", operand: 1, unit: "facts" },
          { operation: "add-coins-per-selected", operand: 1, unit: "coins" },
        ),
      ),
    ).toBe("×2\n^1.2\n+2 coins\n+1 coin");
  });

  it("says when a grant found no room, and never invents an effect", () => {
    expect(
      describeActivation(activation({ operation: "grant-unowned-passive.committed", operand: 1 })),
    ).toBe("+1 passive");
    expect(
      describeActivation(activation({ operation: "grant-unowned-passive.committed", operand: 0 })),
    ).toBe("Rack full");
    expect(describeActivation(activation({ operation: "test.unknown", before: 4, after: 4 }))).toBe(
      "",
    );
    expect(describeActivation(activation({ operation: "test.unknown", before: 4, after: 2 }))).toBe(
      "4 → 2",
    );
  });

  it("uses the descriptor a definition composes, registered like any other", () => {
    activationDescriptors.register(
      "test.shout",
      (resolved, config) => `${(config as { prefix: string }).prefix}${resolved.outcomes.length}`,
    );
    const result = describePassiveActivation(
      { activationDescriptor: { descriptor: "test.shout", config: { prefix: "!" } } },
      activation({ operation: "add-line-score", operand: 1 }),
    );
    expect(result).toBe("!1");
    expect(
      describePassiveActivation({}, activation({ operation: "add-line-score", operand: 1 })),
    ).toBe("+1");
  });

  it("formats numbers deterministically", () => {
    expect([6, 1.5, 3.0789, -2].map(formatNumber)).toEqual(["6", "1.5", "3.08", "-2"]);
  });
});

describe("descriptor from real scoring (#484)", () => {
  it("describes a D6's committed activation with its actual roll", async () => {
    const { scoreFieldWithPassives } = await import("./passive-effects");
    const { createPassiveBlock, passiveDefinitions } = await import("./passives");
    const { standardDeck } = await import("./cards");
    const field = standardDeck.slice(0, 5).map((block, x) => ({ block, cell: { x, y: 0, z: 0 } }));
    const die = createPassiveBlock("d6", "passive.1");
    const [line] = scoreFieldWithPassives(field, [die], undefined, () => 0.99);
    const rolled = line!.activations.find(({ sourceId }) => sourceId === "passive.1")!;
    expect(describePassiveActivation(passiveDefinitions.get("d6"), rolled)).toBe("+6");
  });
});
