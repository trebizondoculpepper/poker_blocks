import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import type { GameState, PlacedBlock } from "./game-state";
import { getMaterialDefinition, withMaterial } from "./materials";
import {
  acquiredModifier,
  addCardModifier,
  clearModifierLifetime,
  combineModifiers,
} from "./modifier-registers";
import { scoreFieldWithPassives } from "./passive-effects";
import { resetRoundState } from "./round-end";
import { demoRunRules } from "./run-rules";
import { fromSaveRecord, toSaveRecord } from "./save";
import { resetStageState } from "./stage-end";

const card = (rank: string, suit: string): CardBlock =>
  standardDeck.find(
    (block) => block.traits.identity.rank === rank && block.traits.identity.suit.name === suit,
  )!;
const row = (...blocks: CardBlock[]): PlacedBlock[] =>
  blocks.map((block, x) => ({ block, cell: { x, y: 0, z: 0 } }));
const points = (field: PlacedBlock[]) => scoreFieldWithPassives(field, [])[0]!.points;
const bare = (cards: CardBlock[]): GameState => ({
  field: [],
  hand: cards,
  deck: [],
  discardPile: [],
  passiveRack: [],
  coins: 0,
  round: { score: 0, targetScore: 10, movesLeft: 5, discardsLeft: 3 },
});

describe("combining modifiers (#431)", () => {
  it("sums additives, multiplies multipliers and adds exponents' increases above 1", () => {
    expect(combineModifiers([{ additive: 1 }, { additive: 1 }])).toEqual({ additive: 2 });
    expect(combineModifiers([{ multiplicative: 2 }, { multiplicative: 3 }])).toEqual({
      multiplicative: 6,
    });
    expect(combineModifiers([{ exponential: 1.1 }, { exponential: 1.2 }]).exponential).toBeCloseTo(
      1.3,
    );
    expect(combineModifiers([])).toEqual({});
  });
});

describe("acquired modifier registers (#431)", () => {
  const [a, b] = [card("7", "hearts"), card("7", "clubs")];

  it("keeps stage, round and run registers apart, combined for scoring", () => {
    let state = bare([a, b]);
    state = addCardModifier(state, a.id, "round", { additive: 1 })!;
    state = addCardModifier(state, a.id, "run", { additive: 1 })!;
    state = addCardModifier(state, a.id, "stage", { multiplicative: 2 })!;
    const held = state.hand[0]!;
    expect(held.traits.modifiers).toEqual({
      round: { additive: 1 },
      run: { additive: 1 },
      stage: { multiplicative: 2 },
    });
    expect(acquiredModifier(held)).toEqual({ additive: 2, multiplicative: 2 });
    expect(state.cardStates?.[a.id]?.modifiers).toEqual(held.traits.modifiers);
    // Its material's own values are untouched.
    expect(getMaterialDefinition("paper").scoringModifier).toBeUndefined();
  });

  it("clears each register at its own boundary: stage at stage end, round at round end", () => {
    let state = bare([a]);
    for (const lifetime of ["stage", "round", "run"])
      state = addCardModifier(state, a.id, lifetime, { additive: 1 })!;
    const afterStage = resetStageState(state);
    expect(Object.keys(afterStage.hand[0]!.traits.modifiers!)).toEqual(["round", "run"]);
    const afterRound = resetRoundState(afterStage);
    expect(afterRound.hand[0]!.traits.modifiers).toEqual({ run: { additive: 1 } });
    expect(afterRound.cardStates?.[a.id]).toEqual({ modifiers: { run: { additive: 1 } } });
    const none = clearModifierLifetime(afterRound, "run");
    expect(none.hand[0]!.traits.modifiers).toBeUndefined();
    expect(none.cardStates).toBeUndefined();
  });

  it("refuses an unknown lifetime or a card that isn't there", () => {
    expect(() => addCardModifier(bare([a]), a.id, "forever", { additive: 1 })).toThrow();
    expect(addCardModifier(bare([a]), "nobody", "run", { additive: 1 })).toBeNull();
  });

  it("scores acquired exponents additively: ^1.1 and ^1.2 make ^1.3, not ^1.32", () => {
    const plain = points(row(a, b));
    let state = bare([a, b]);
    state = addCardModifier(state, a.id, "run", { exponential: 1.1 })!;
    state = addCardModifier(state, b.id, "round", { exponential: 1.2 })!;
    const [ra, rb] = state.hand as [CardBlock, CardBlock];
    expect(points(row(ra, rb))).toBe(Math.round(plain ** 1.3));
    expect(points(row(ra, rb))).not.toBe(Math.round(plain ** 1.32));
  });

  it("adds a material's own exponent the same way: Magic ^1.2 with an acquired ^1.1 is ^1.3", () => {
    const magic = withMaterial(a, getMaterialDefinition("magic"));
    const before = points(row(magic, b));
    const boosted = addCardModifier(bare([magic, b]), magic.id, "run", { exponential: 1.1 })!;
    const after = points(row(boosted.hand[0]!, b));
    // Same working value before the power phase: the exponent moves from 1.2 to 1.3.
    const base = before ** (1 / 1.2);
    expect(after).toBeCloseTo(Math.round(base ** 1.3), -1);
    expect(after).toBeGreaterThan(before);
  });

  it("keeps every register through save and Continue, and refuses a bad one", () => {
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
    const held = game.state.hand[0]!;
    let state = addCardModifier(game.state, held.id, "run", { multiplicative: 2 })!;
    state = addCardModifier(state, held.id, "stage", { additive: 3 })!;
    const record = JSON.parse(JSON.stringify(toSaveRecord({ ...game.snapshot(), state })));
    const restored = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    const back = restored.state.hand.find(({ id }) => id === held.id)!;
    expect(back.traits.modifiers).toEqual({ run: { multiplicative: 2 }, stage: { additive: 3 } });
    const bad = structuredClone(record);
    bad.state.cardStates[held.id].modifiers = { forever: { additive: 1 } };
    expect(fromSaveRecord(bad, standardDeck, dealerRegistry)).toBeNull();
  });

  it("scores the same in any order, even when exponents sum through zero (#476 review)", () => {
    const sevens = [card("7", "hearts"), card("7", "clubs"), card("7", "spades")];
    const plain = points(row(...sevens));
    const scoredWith = (powers: number[]) => {
      let state = bare(sevens);
      powers.forEach((exponential, index) => {
        state = addCardModifier(state, sevens[index]!.id, "run", { exponential })!;
      });
      return points(row(...(state.hand as CardBlock[])));
    };
    const expected = Math.round(plain ** (1 + (0.5 - 1) + (0.5 - 1) + (2 - 1)));
    expect(scoredWith([0.5, 0.5, 2])).toBe(expected);
    expect(scoredWith([2, 0.5, 0.5])).toBe(expected);
    expect(scoredWith([0.5, 2, 0.5])).toBe(expected);
  });

  it("saves and restores a register whose exponents combine to zero or below (#476 review)", () => {
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
    const held = game.state.hand[0]!;
    let state = addCardModifier(game.state, held.id, "run", { exponential: 0.5 })!;
    state = addCardModifier(state, held.id, "run", { exponential: 0.5 })!;
    state = addCardModifier(state, held.id, "run", { exponential: 0.4 })!;
    const record = JSON.parse(JSON.stringify(toSaveRecord({ ...game.snapshot(), state })));
    const restored = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    expect(restored).not.toBeNull();
    const back = restored.state.hand.find(({ id }) => id === held.id)!;
    expect(back.traits.modifiers!.run!.exponential).toBeCloseTo(-0.6);
  });
});

describe("acquired modifiers follow the card's eligibility (#476 review)", () => {
  it("a cloud's acquired bonus applies in its line as its material's does, chosen hand or not", () => {
    const cloud = withMaterial(card("3", "spades"), getMaterialDefinition("cloud"));
    const [x, y] = [card("7", "hearts"), card("7", "clubs")];
    const plain = points(row(x, y, cloud));
    const boosted = addCardModifier(bare([x, y, cloud]), cloud.id, "run", { multiplicative: 2 })!;
    expect(points(row(x, y, boosted.hand[2]!))).toBe(plain * 2);
  });
});

describe("register boundaries (#476 review)", () => {
  const [a, b] = [card("7", "hearts"), card("7", "clubs")];

  it("refuses a combination that can't be stored, changing nothing", () => {
    const once = addCardModifier(bare([a]), a.id, "run", { multiplicative: 1e-200 })!;
    expect(() => addCardModifier(once, a.id, "run", { multiplicative: 1e-200 })).toThrow();
    expect(once.hand[0]!.traits.modifiers).toEqual({ run: { multiplicative: 1e-200 } });
  });

  it("refuses malformed saved registers, and accepts an empty one as neutral", async () => {
    const { restoreModifierRegisters } = await import("./modifier-registers");
    expect(restoreModifierRegisters({ run: {} })).toEqual({ run: {} });
    for (const bad of [
      { run: 5 },
      { run: [] },
      { run: null },
      { run: { additive: "1" } },
      { run: { power: 2 } },
    ])
      expect(() => restoreModifierRegisters(bad)).toThrow();
  });

  it("scores a line whose power has no finite result as nothing, never Infinity", () => {
    let state = bare([a, b]);
    state = addCardModifier(state, a.id, "run", { additive: -100 })!;
    state = addCardModifier(state, b.id, "run", { exponential: 0.5 })!;
    state = addCardModifier(state, b.id, "run", { exponential: 0.5 })!;
    state = addCardModifier(state, b.id, "run", { exponential: 0.4 })!;
    const scored = points(row(...(state.hand as [CardBlock, CardBlock])));
    expect(Number.isFinite(scored)).toBe(true);
    expect(scored).toBeGreaterThanOrEqual(0);
  });
});
