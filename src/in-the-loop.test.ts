import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { PlacedBlock } from "./game-state";
import { scoreFieldWithPassives } from "./passive-effects";
import { createPassiveBlock, ordinaryPassives, passiveDefinitions } from "./passives";
import { contextQueries } from "./context-queries";
import { describeActivation } from "./activation-descriptor";
import { inTheLoop, inTheLoopPower } from "./in-the-loop";
import "./trial-modifiers";

const card = (index: number): CardBlock => ({
  ...standardDeck[index % 52]!,
  id: `c${index}`,
});
const at = (cells: [number, number][]): PlacedBlock[] =>
  cells.map(([x, y], index) => ({ block: card(index), cell: { x, y, z: 0 } }));

// A 3×3 ring round an empty centre: one face-connected hoop. Its bottom row scores.
const ringCells: [number, number][] = [
  [0, 0],
  [1, 0],
  [2, 0],
  [0, 1],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
];
// The same cells with the centre filled: a slab, no hoop.
const slabCells: [number, number][] = [...ringCells, [1, 1]];

const loop = (id = "loop") => createPassiveBlock("trial-in-the-loop", id);
const outcomesOf = (lines: ReturnType<typeof scoreFieldWithPassives>) =>
  lines.flatMap(({ activations }) => activations.flatMap(({ outcomes }) => outcomes));

describe("In the Loop (#886)", () => {
  it("raises every scored row to ^1.2 while the field has a hoop", () => {
    const field = at(ringCells);
    const base = scoreFieldWithPassives(field, []);
    const scored = scoreFieldWithPassives(field, [loop()]);
    expect(scored.length).toBe(base.length);
    expect(base.length).toBeGreaterThan(0);
    scored.forEach((line, index) => {
      const before = base[index]!.points;
      expect(line.points).toBeCloseTo(Math.round(before ** inTheLoopPower), -1);
    });
    expect(outcomesOf(scored).every(({ operand }) => operand === inTheLoopPower)).toBe(true);
  });

  it("is neutral without a hoop, reported as such, not as a fallback", () => {
    const field = at(slabCells);
    const base = scoreFieldWithPassives(field, []).map(({ points }) => points);
    const scored = scoreFieldWithPassives(field, [loop()]);
    expect(scored.map(({ points }) => points)).toEqual(base);
    expect(outcomesOf(scored).every(({ operand, note }) => operand === 1 && !note)).toBe(true);
  });

  it("adds its increase to other exponents rather than powering a powered row", () => {
    const field = at(ringCells);
    const base = scoreFieldWithPassives(field, [])[0]!.points;
    const two = scoreFieldWithPassives(field, [loop("a"), loop("b")])[0]!.points;
    // Two copies: ^(1 + 0.2 + 0.2) = ^1.4, not (base^1.2)^1.2 = base^1.44.
    expect(two).toBeCloseTo(Math.round(base ** 1.4), -1);
  });

  it("falls back to a neutral exponent with a captured note when the query is unavailable", () => {
    // The same generic effect over a query that can't measure (as faceHoop reports past a limit).
    if (!contextQueries.has("testUnmeasured"))
      contextQueries.register("testUnmeasured", {
        cost: "test",
        limit: 1,
        size: () => 0,
        run: () => ({ available: false, reason: "cell-limit" }),
      });
    if (!passiveDefinitions.has("test-unmeasured-loop"))
      passiveDefinitions.register("test-unmeasured-loop", {
        ...inTheLoop,
        id: "test-unmeasured-loop",
        eventRules: [
          {
            ...inTheLoop.eventRules![0]!,
            effects: [
              {
                id: "power-line-score-if-query",
                config: { query: "testUnmeasured", value: "hasLoop", power: inTheLoopPower },
              },
            ],
          },
        ],
      });
    const field = at(ringCells);
    const base = scoreFieldWithPassives(field, []).map(({ points }) => points);
    const scored = scoreFieldWithPassives(field, [createPassiveBlock("test-unmeasured-loop", "u")]);
    expect(scored.map(({ points }) => points)).toEqual(base);
    const outcomes = outcomesOf(scored);
    expect(outcomes.every(({ operand }) => operand === 1)).toBe(true);
    expect(outcomes[0]!.note).toBe("topology not measured: cell-limit");
    expect(describeActivation(scored[0]!.activations[0]!)).toBe(
      "topology not measured: cell-limit",
    );
  });

  it("describes what it actually did", () => {
    const [hoop] = scoreFieldWithPassives(at(ringCells), [loop()]);
    expect(describeActivation(hoop!.activations[0]!)).toBe("^1.2");
  });

  it("is provisional: never in normal shops", () => {
    expect(ordinaryPassives().map(({ id }) => id)).not.toContain("trial-in-the-loop");
  });
});
