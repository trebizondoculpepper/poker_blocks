import { describe, expect, it } from "vite-plus/test";
import { EventRuleRegistry, type EventRule, type RuleFrame } from "./event-rules";

const frame = (): RuleFrame => ({
  event: { type: "test.event" },
  state: {
    field: [],
    hand: [],
    deck: [],
    discardPile: [],
    passiveRack: [],
    coins: 0,
    round: { score: 0, targetScore: 10, movesLeft: 1, discardsLeft: 1 },
  },
  workingValue: 3,
  commands: [],
});

describe("event rule handler contract", () => {
  it("composes test-only handlers in effect order without interpreting their IDs", () => {
    const registry = new EventRuleRegistry();
    registry.registerSelector<{ value: number }, number>("test-select", ({ value }) => value);
    registry.registerCondition<{ minimum: number }, number>(
      "test-minimum",
      ({ minimum }, selected) => selected >= minimum,
    );
    registry.registerEffect<{ amount: number }, number>(
      "test-add",
      ({ amount }, selected, current) => ({
        ...current,
        workingValue: (current.workingValue ?? 0) + selected + amount,
      }),
    );
    registry.registerEffect<{ factor: number }, number>(
      "test-multiply",
      ({ factor }, _selected, current) => ({
        ...current,
        workingValue: (current.workingValue ?? 0) * factor,
      }),
    );
    const rule: EventRule = {
      on: "test.event",
      select: { id: "test-select", config: { value: 2 } },
      where: { id: "test-minimum", config: { minimum: 2 } },
      effects: [
        { id: "test-add", config: { amount: 1 } },
        { id: "test-multiply", config: { factor: 2 } },
      ],
    };
    const original = frame();
    expect(registry.evaluate(rule, original).workingValue).toBe(12);
    expect(original.workingValue).toBe(3);
    expect(JSON.parse(JSON.stringify(rule))).toEqual(rule);
  });

  it("returns the incoming working value when a condition does not match", () => {
    const registry = new EventRuleRegistry();
    registry.registerSelector("test-select", () => 2);
    registry.registerCondition<{ minimum: number }, number>(
      "test-minimum",
      ({ minimum }, selected) => selected >= minimum,
    );
    const rule: EventRule = {
      on: "test.event",
      select: { id: "test-select", config: {} },
      where: { id: "test-minimum", config: { minimum: 3 } },
      effects: [],
    };
    expect(registry.evaluate(rule, frame()).workingValue).toBe(3);
  });

  it("fails clearly for an unregistered handler", () => {
    const registry = new EventRuleRegistry();
    expect(() =>
      registry.evaluate(
        {
          on: "test.event",
          select: { id: "missing", config: {} },
          where: { id: "missing", config: {} },
          effects: [],
        },
        frame(),
      ),
    ).toThrow("Unknown selector: missing");
  });
});
