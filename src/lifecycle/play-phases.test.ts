import { afterEach, describe, expect, it } from "vite-plus/test";
import { standardDeck } from "../cards";
import { dealerRegistry } from "../dealer";
import { GameRun } from "../game-run";
import { getMaterialDefinition, withMaterial, type MaterialDefinition } from "../materials";
import { registerRuleCommand } from "../rule-commands";
import { demoRunRules, sandboxRunRules, type RunRules } from "../run-rules";
import { validatePlayPhases } from "./play-phases";

// No material counts down yet: lend wood a countdown that fires on its own placement.
if (!(globalThis as { __phaseFired?: boolean }).__phaseFired) {
  registerRuleCommand("test-phase-fired", () => [{ type: "test.fired" }]);
  (globalThis as { __phaseFired?: boolean }).__phaseFired = true;
}
type Lendable = { -readonly [K in keyof MaterialDefinition]: MaterialDefinition[K] };
const wood = getMaterialDefinition("wood") as Lendable;
afterEach(() => {
  delete wood.triggerCountdown;
  delete wood.triggerable;
});

const runWith = (rules: RunRules = sandboxRunRules(demoRunRules), lendCountdown = false) => {
  if (lendCountdown) {
    wood.triggerCountdown = { start: 1, countPlacement: true };
    wood.triggerable = { responses: [{ id: "test-phase-fired", config: {} }] };
  }
  const opening = new GameRun(dealerRegistry, rules, standardDeck, () => 0);
  const hand = [withMaterial(standardDeck[0]!, getMaterialDefinition("wood")), standardDeck[13]!];
  return {
    game: GameRun.fromSnapshot(
      dealerRegistry,
      rules,
      standardDeck,
      { ...opening.snapshot(), state: { ...opening.state, hand } },
      () => 0,
    ),
    hand,
  };
};

describe("a play resolves in the documented phases (#658)", () => {
  it("records placement, before score, score, after score and settlement, in that order", () => {
    const { game, hand } = runWith();
    expect(game.play({ cardId: hand[0]!.id })).not.toBeNull();
    const phases = [...new Set(game.actionFacts.map(({ phase }) => phase))];
    expect(phases).toEqual(["placement", "beforeScore", "score", "afterScore", "settle"]);
    const types = game.actionFacts.map(({ type }) => type);
    expect(types.slice(0, 2)).toEqual(["play.placed", "block.placed"]);
    expect(types.at(-1)).toBe("play.completed");
    expect(types).toContain("score.allLinesFinalized");
    expect(types.indexOf("score.totalApplied")).toBeLessThan(types.indexOf("play.afterScore"));
  });

  it("reports each placed block in placement order, and the batch once", () => {
    const { game, hand } = runWith();
    expect(game.play({ cardId: hand[0]!.id })).not.toBeNull();
    // A second play: a line of the next card.
    const next = game.state.hand[0]!;
    expect(game.play({ cardId: next.id, targetId: hand[0]!.id, face: "east" })).not.toBeNull();
    const placed = game.actionFacts.filter(({ type }) => type === "block.placed");
    expect(placed.map(({ subjectIds }) => subjectIds[0])).toEqual([next.id]);
    expect(game.actionFacts.filter(({ type }) => type === "play.placed")).toHaveLength(1);
  });

  it("counts a countdown down before scoring and detonates it after", () => {
    const { game, hand } = runWith(undefined, true);
    expect(game.play({ cardId: hand[0]!.id })).not.toBeNull();
    const fired = game.actionFacts.find(({ type }) => type === "test.fired");
    expect(fired?.phase).toBe("afterScore");
    const types = game.actionFacts.map(({ type }) => type);
    expect(types.indexOf("test.fired")).toBeGreaterThan(types.indexOf("score.totalApplied"));
  });

  it("runs no material steps when none are composed", () => {
    const rules = {
      ...sandboxRunRules(demoRunRules),
      playPhases: { beforeScore: [], afterScore: [] },
    };
    const { game, hand } = runWith(rules, true);
    expect(game.play({ cardId: hand[0]!.id })).not.toBeNull();
    expect(game.actionFacts.some(({ type }) => type === "test.fired")).toBe(false);
  });

  it("validates a phase configuration: every step registered, none twice", () => {
    expect(
      validatePlayPhases({ beforeScore: ["countdown-deductions"], afterScore: ["reactions"] }),
    ).toEqual([]);
    expect(
      validatePlayPhases({ beforeScore: ["nope"], afterScore: ["reactions", "reactions"] }),
    ).toEqual(['unknown play step "nope"', 'play step "reactions" listed twice']);
  });
});
