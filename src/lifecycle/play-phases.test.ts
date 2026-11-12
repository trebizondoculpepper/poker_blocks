import { afterEach, describe, expect, it } from "vite-plus/test";
import { standardDeck } from "../cards";
import { dealerRegistry } from "../dealer";
import { GameRun } from "../game-run";
import { getMaterialDefinition, withMaterial, type MaterialDefinition } from "../materials";
import { registerRuleCommand } from "../rule-commands";
import { demoRunRules, sandboxRunRules, type RunRules } from "../run-rules";
import { playSteps, validatePlayPhases } from "./play-phases";

// No material counts down yet: lend wood a countdown that fires on its own placement.
const fired: string[] = [];
if (!(globalThis as { __phaseFired?: boolean }).__phaseFired) {
  registerRuleCommand("test-phase-fired", () => {
    fired.push("fired");
    return [{ type: "test.fired" }];
  });
  (globalThis as { __phaseFired?: boolean }).__phaseFired = true;
}
type Lendable = { -readonly [K in keyof MaterialDefinition]: MaterialDefinition[K] };
const wood = getMaterialDefinition("wood") as Lendable;
afterEach(() => {
  delete wood.triggerCountdown;
  delete wood.triggerable;
  fired.length = 0;
});

const material = (beforeScore: string[], afterScore: string[]) => [
  { id: "materialEffectsController", config: { beforeScore, afterScore } },
];

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

describe("material steps come from the playfield's composed controllers (#658)", () => {
  it("runs the game's countdown when the material controller is composed", () => {
    const { game, hand } = runWith(undefined, true);
    expect(game.play({ cardId: hand[0]!.id })).not.toBeNull();
    expect(fired).toEqual(["fired"]);
  });

  it("runs no material steps when no controller is composed onto the playfield", () => {
    const { game, hand } = runWith({ ...sandboxRunRules(demoRunRules), playfield: [] }, true);
    expect(game.play({ cardId: hand[0]!.id })).not.toBeNull();
    expect(fired).toEqual([]);
  });

  it("refuses an unknown controller, or a step attached twice, as the run is composed", () => {
    const base = sandboxRunRules(demoRunRules);
    const compose = (playfield: RunRules["playfield"]) => () =>
      new GameRun(dealerRegistry, { ...base, playfield }, standardDeck, () => 0);
    expect(compose([{ id: "nope", config: {} }])).toThrow(/nope/);
    expect(compose(material(["countdown-deductions", "countdown-deductions"], []))).toThrow(
      /listed twice/,
    );
  });

  it("shows pre-score steps the score from before the play", () => {
    const seen: number[] = [];
    if (!playSteps.has("test.score-probe"))
      playSteps.register("test.score-probe", (context) => {
        seen.push(context.target.state.round.score);
        return [];
      });
    const rules = {
      ...sandboxRunRules(demoRunRules),
      playfield: material(["test.score-probe"], []),
    };
    const { game, hand } = runWith(rules);
    expect(game.play({ cardId: hand[0]!.id })).not.toBeNull();
    const before = game.state.round.score;
    seen.length = 0;
    expect(game.play({ cardId: hand[1]!.id, targetId: hand[0]!.id, face: "east" })).not.toBeNull();
    expect(game.state.round.score).toBeGreaterThan(before);
    expect(seen).toEqual([before]);
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

describe("each step's follow-ups resolve before the next step (#693 review)", () => {
  it("lets a listener's response to one step change what the next step sees", async () => {
    const { passiveTraits, createPassiveBlock } = await import("../passives");
    const seen: number[] = [];
    if (!playSteps.has("test.emit-step"))
      playSteps.register("test.emit-step", () => [{ type: "test.step-emitted" }]);
    if (!playSteps.has("test.coin-probe"))
      playSteps.register("test.coin-probe", (context) => {
        seen.push(context.target.state.coins);
        return [];
      });
    if (!passiveTraits.has("test.step-listener"))
      passiveTraits.register("test.step-listener", {
        id: "test.step-listener",
        listensTo: ["test.step-emitted"],
        respond: () => [{ type: "test.step-answered" }],
      });
    const rules = {
      ...sandboxRunRules(demoRunRules),
      playfield: material(["test.emit-step", "test.coin-probe"], []),
    };
    const base = createPassiveBlock("scrapper", "step.1");
    const opening = new GameRun(dealerRegistry, rules, standardDeck, () => 0);
    opening.installPassive({
      ...base,
      traits: { ...base.traits, passive: { traitId: "test.step-listener" } },
    });
    const game = GameRun.fromSnapshot(
      dealerRegistry,
      rules,
      standardDeck,
      opening.snapshot(),
      () => 0,
    );
    expect(game.play({ cardId: game.state.hand[0]!.id })).not.toBeNull();
    const types = game.actionFacts.map(({ type }) => type);
    // The listener answered the first step before scoring and before the play completed.
    expect(types.indexOf("test.step-answered")).toBeGreaterThan(-1);
    expect(types.indexOf("test.step-answered")).toBeLessThan(types.indexOf("play.completed"));
    expect(seen).toHaveLength(1);
  });
});
