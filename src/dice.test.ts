import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import type { PlacedBlock } from "./game-state";
import { scoreFieldWithPassives } from "./passive-effects";
import { createPassiveBlock, passiveDefinitions } from "./passives";
import { ruleHandlers } from "./rule-handlers";

const card = (rank: string, suit: string): CardBlock =>
  standardDeck.find(
    (block) => block.traits.identity!.rank === rank && block.traits.identity!.suit.name === suit,
  )!;
const at = (block: CardBlock, x: number, y = 0): PlacedBlock => ({ block, cell: { x, y, z: 0 } });
/** Two scoring lines crossing at the 3 of hearts. */
const field = [
  at(card("2", "hearts"), -1),
  at(card("3", "hearts"), 0),
  at(card("4", "hearts"), 1),
  at(card("5", "clubs"), 0, 1),
];
const die = (id: string, index = 1) => createPassiveBlock(id, `passive.${index}`);
/** A random source that hands out the given values in order and counts draws. */
function sequence(...values: number[]) {
  const source = Object.assign(() => values[source.draws++ % values.length]!, { draws: 0 });
  return source;
}

describe("dice passives (#97)", () => {
  const dice = [
    ["d6", 6, "cube", 1, 4],
    ["d8", 8, "octahedron", 2, 5],
    // The former D10 slot: a true D12 under its stable handle (#1003).
    ["d10", 12, "dodecahedron", 3, 6],
    ["d20", 20, "icosahedron", 4, 9],
  ] as const;

  it.each(dice)(
    "%s: %d sides on a %s, unlocked in round %d for %d coins",
    (id, sides, shape, round, price) => {
      const definition = passiveDefinitions.get(id);
      expect(definition.shape).toBe(shape);
      expect(definition.shop).toMatchObject({ unlockRound: round, basePrice: price });
      expect(definition.faces?.map(({ label }) => label)).toEqual(
        Array.from({ length: sides }, (_, index) => String(index + 1)),
      );
      // Face i sits opposite face N-1-i (src/passive-visual.ts), so opposite faces sum to N + 1.
      const faces = definition.faces!;
      faces.forEach((face, index) =>
        expect(Number(face.label) + Number(faces[sides - 1 - index]!.label)).toBe(sides + 1),
      );
    },
  );

  it("draws the D6 with pips", () => {
    expect(passiveDefinitions.get("d6").faces?.map(({ pips }) => pips)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("rolls once per resolution and adds the same roll to every scored line", () => {
    const base = scoreFieldWithPassives(field, []);
    // 0.5 on a D6 rolls 4.
    const random = sequence(0.5);
    const rolled = scoreFieldWithPassives(field, [die("d6")], undefined, random);
    expect(random.draws).toBe(1);
    expect(rolled.map(({ points }, index) => points - base[index]!.points)).toEqual([4, 4]);
  });

  it("rolls each die independently, and every die's roll applies to every line", () => {
    const base = scoreFieldWithPassives(field, []);
    // D6 rolls 1 (0.0), D20 rolls 20 (0.99).
    const random = sequence(0, 0.99);
    const rolled = scoreFieldWithPassives(field, [die("d6", 1), die("d20", 2)], undefined, random);
    expect(random.draws).toBe(2);
    expect(rolled.map(({ points }, index) => points - base[index]!.points)).toEqual([21, 21]);
  });

  it("rolls again for the next resolution", () => {
    const random = sequence(0, 0.99);
    const first = scoreFieldWithPassives(field, [die("d6")], undefined, random);
    const second = scoreFieldWithPassives(field, [die("d6")], undefined, random);
    expect(second[0]!.points - first[0]!.points).toBe(5);
  });

  it("adds the roll after the zero clamp, so it cannot rescue a negative line", () => {
    // Each contributing card takes 20 from its line before the clamp, driving it negative.
    const minus = () => [
      {
        on: "score.beforeLineFinalized",
        select: { id: "scored-line", config: {} },
        where: { id: "always", config: {} },
        effects: [{ id: "add-line-score", config: { amount: -20 } }],
      },
    ];
    const short = [at(card("2", "hearts"), 0), at(card("2", "clubs"), 1)];
    expect(scoreFieldWithPassives(short, [], minus)[0]!.points).toBe(0);
    // A D6 rolling 4 then gives exactly 4, not 4 added to a negative score.
    const random = sequence(0.5);
    expect(scoreFieldWithPassives(short, [die("d6")], minus, random)[0]!.points).toBe(4);
  });

  it("never draws randomness when no rule has a random amount", () => {
    const random = sequence(0.5);
    scoreFieldWithPassives(field, [die("double-line"), die("crossroads", 2)], undefined, random);
    expect(random.draws).toBe(0);
  });

  it("rolls every face from 1 to N", () => {
    const rolls = new Set<number>();
    for (let n = 0; n < 20; n++) {
      const value = (n + 0.5) / 20;
      const rule = ruleHandlers.resolveValues(
        passiveDefinitions.get("d20").eventRules[0]!,
        () => value,
      );
      rolls.add((rule.effects[0]!.config as { amount: number }).amount);
    }
    expect([...rolls].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("guardrail: dice come from configuration, never from named branches in the run or scorer", () => {
    for (const file of [
      "game-run.ts",
      "game-run-controller.ts",
      "passive-effects.ts",
      "rule-handlers.ts",
      "event-rules.ts",
    ]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/"d(6|8|10|20)"|diceSides/);
    }
  });
});

describe("the D12 in the former D10 slot (#1003; doc/dice-replacement.md)", async () => {
  const { GameRun } = await import("./game-run");
  const { dealerRegistry } = await import("./dealer");
  const { demoRunRules } = await import("./run-rules");
  const { fromSaveRecord, toSaveRecord } = await import("./save");

  it("rolls a uniform 1–12 once per resolution, the same roll on every line", () => {
    const base = scoreFieldWithPassives(field, []);
    for (const [draw, roll] of [
      [0, 1],
      [0.5, 7],
      [0.999, 12],
    ] as const) {
      const random = sequence(draw);
      const rolled = scoreFieldWithPassives(field, [die("d10")], undefined, random);
      expect(random.draws).toBe(1);
      expect(rolled.map(({ points }, index) => points - base[index]!.points)).toEqual([roll, roll]);
    }
  });

  it("is named and described as a D12", () => {
    const definition = passiveDefinitions.get("d10");
    expect(definition.name).toBe("D12");
    expect(definition.description).toContain("1–12");
  });

  it("restores a saved D10 instance as the D12, keeping its identity and rack place", () => {
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0);
    const saved = createPassiveBlock("d10", "passive.saved");
    const run = GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, {
      ...game.snapshot(),
      state: { ...game.state, passiveRack: [die("d6", 1), saved] },
    });
    const json = JSON.parse(JSON.stringify(toSaveRecord(run.snapshot())));
    const restored = fromSaveRecord(json, standardDeck, dealerRegistry)!.state.passiveRack;
    expect(restored.map(({ id, definitionId }) => [id, definitionId])).toEqual([
      ["passive.1", "d6"],
      ["passive.saved", "d10"],
    ]);
    expect(restored[1]!.traits.appearance?.shape).toBe("dodecahedron");
    expect(restored[1]!.traits.appearance?.faces).toHaveLength(12);
  });
});
