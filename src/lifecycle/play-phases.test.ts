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

/** A run with one passive whose rules (or trait) listen to the play's facts. */
const withListener = async (
  passive: Record<string, unknown>,
  rules = sandboxRunRules(demoRunRules),
) => {
  const { createPassiveBlock } = await import("../passives");
  const base = createPassiveBlock("scrapper", "listener.1");
  const opening = new GameRun(dealerRegistry, rules, standardDeck, () => 0);
  opening.installPassive({
    ...base,
    traits: { ...base.traits, passive },
  } as unknown as typeof base);
  return GameRun.fromSnapshot(dealerRegistry, rules, standardDeck, opening.snapshot(), () => 0);
};
const rule = (on: string, effects: unknown[]) => ({
  traitId: "passive.event-rules",
  eventRules: [
    {
      on,
      select: { id: "event-blocks", config: { where: { id: "always", config: {} } } },
      where: { id: "count-at-least", config: { minimum: 1 } },
      effects,
    },
  ],
});

describe("a play resolves in the documented phases (#658)", () => {
  it("records placement, before score, score, after score and settlement, in that order", () => {
    const { game, hand } = runWith();
    expect(game.play({ cardId: hand[0]!.id })).not.toBeNull();
    const phases = [...new Set(game.actionFacts.map(({ phase }) => phase))];
    expect(phases).toEqual(["placement", "beforeScore", "afterScore", "settle"]);
    const types = game.actionFacts.map(({ type }) => type);
    expect(types.slice(0, 2)).toEqual(["play.placed", "block.placed"]);
    expect(types.at(-1)).toBe("play.completed");
  });

  it("reports each placed block once, and the batch once", () => {
    const { game, hand } = runWith();
    expect(game.play({ cardId: hand[0]!.id })).not.toBeNull();
    const next = game.state.hand[0]!;
    expect(game.play({ cardId: next.id, targetId: hand[0]!.id, face: "east" })).not.toBeNull();
    const placed = game.actionFacts.filter(({ type }) => type === "block.placed");
    expect(placed.map(({ subjectIds }) => subjectIds[0])).toEqual([next.id]);
    expect(game.actionFacts.filter(({ type }) => type === "play.placed")).toHaveLength(1);
  });

  it("detonates a countdown in the after-score phase", () => {
    const { game, hand } = runWith(undefined, true);
    expect(game.play({ cardId: hand[0]!.id })).not.toBeNull();
    expect(game.actionFacts.find(({ type }) => type === "test.fired")?.phase).toBe("afterScore");
  });

  it("records a deciding play's outcome in the settle phase and batch", () => {
    const base = sandboxRunRules(demoRunRules);
    const rules: RunRules = {
      ...base,
      stage: (round, kind) => ({ ...base.stage(round, kind), targetScore: 1_000_000, plays: 1 }),
    };
    const { game, hand } = runWith(rules);
    expect(game.play({ cardId: hand[0]!.id })).not.toBeNull();
    const completed = game.actionFacts.find(({ type }) => type === "play.completed")!;
    const outcome = game.actionFacts.find(({ type }) => /^stage\.(won|lost)$/.test(type));
    expect(outcome?.phase).toBe("settle");
    expect(outcome?.batchId).toBe(completed.batchId);
  });
});

describe("rules run at the play's phase barriers (#658)", () => {
  it("commits a play.beforeScore rule's commands", async () => {
    const game = await withListener(
      rule("play.beforeScore", [{ id: "add-coins", config: { amount: 3 } }]),
    );
    const coins = game.state.coins;
    expect(game.play({ cardId: game.state.hand[0]!.id })).not.toBeNull();
    expect(game.state.coins).toBe(coins + 3);
  });

  it("gives block.placed the block the event-blocks selector reads", async () => {
    const game = await withListener(
      rule("block.placed", [{ id: "add-coins", config: { amount: 2 } }]),
    );
    const coins = game.state.coins;
    expect(game.play({ cardId: game.state.hand[0]!.id })).not.toBeNull();
    expect(game.state.coins).toBe(coins + 2);
  });

  it("rolls a hook rule's value as it is delivered, never during line scoring", async () => {
    const roll = { id: "add-coins", config: { amount: { valueSource: "roll", sides: 6 } } };
    const game = await withListener(rule("play.afterScore", [roll]));
    const coins = game.state.coins;
    expect(game.play({ cardId: game.state.hand[0]!.id })).not.toBeNull();
    expect(game.state.coins - coins).toBeGreaterThanOrEqual(1);
    expect(game.state.coins - coins).toBeLessThanOrEqual(6);
    const { scoreFieldWithPassives } = await import("../passive-effects");
    const [listener] = game.state.passiveRack;
    const never = () => {
      throw new Error("drew a random value");
    };
    expect(() =>
      scoreFieldWithPassives(game.state.field, [listener!], undefined, never),
    ).not.toThrow();
  });
});

describe("delivered payloads are captured (#658)", () => {
  const meddler = async (on: string, meddle: (event: Record<string, unknown>) => void) => {
    const { passiveTraits } = await import("../passives");
    const id = `test.meddler.${on}`;
    const state = { refused: false };
    if (!passiveTraits.has(id))
      passiveTraits.register(id, {
        id,
        listensTo: [on],
        respond: (_block, event) => {
          try {
            meddle(event as unknown as Record<string, unknown>);
          } catch {
            state.refused = true;
          }
          return [];
        },
      });
    return { game: await withListener({ traitId: id }), state };
  };

  it("refuses a listener's change to a placed block", async () => {
    const { game, state } = await meddler("block.placed", (event) => {
      (event.blocks as { traits: Record<string, unknown> }[])[0]!.traits.meddled = true;
    });
    const id = game.state.hand[0]!.id;
    expect(game.play({ cardId: id })).not.toBeNull();
    expect(state.refused).toBe(true);
    const onField = game.state.field.find(({ block }) => block.id === id)!.block;
    expect((onField.traits as Record<string, unknown>).meddled).toBeUndefined();
  });

  it("refuses a listener's change to the placed card IDs", async () => {
    const { game, state } = await meddler("play.placed", (event) => {
      (event.cardIds as string[]).push("intruder");
    });
    const id = game.state.hand[0]!.id;
    expect(game.play({ cardId: id })).not.toBeNull();
    expect(state.refused).toBe(true);
    const completed = game.actionFacts.find(({ type }) => type === "play.completed")!;
    expect(completed.subjectIds).toEqual([id]);
  });
});

describe("per-block payloads are frozen too (#695 review)", () => {
  it("refuses a listener's change to block.placed's block list", async () => {
    const { passiveTraits } = await import("../passives");
    let refused = false;
    if (!passiveTraits.has("test.list-meddler"))
      passiveTraits.register("test.list-meddler", {
        id: "test.list-meddler",
        listensTo: ["block.placed"],
        respond: (_block, event) => {
          try {
            (event.blocks as unknown[]).pop();
          } catch {
            refused = true;
          }
          return [];
        },
      });
    const game = await withListener({ traitId: "test.list-meddler" });
    expect(game.play({ cardId: game.state.hand[0]!.id })).not.toBeNull();
    expect(refused).toBe(true);
    const placed = game.actionFacts.find(({ type }) => type === "block.placed")!;
    expect((placed.payload as { blocks: unknown[] }).blocks).toHaveLength(1);
  });
});

describe("a play's facts name what was placed (#695 review)", () => {
  it("refuses a group whose primary card is not its first, changing nothing", () => {
    const { game, hand } = runWith();
    const before = game.state;
    expect(game.play({ cardId: hand[0]!.id, cardIds: [hand[1]!.id] })).toBeNull();
    expect(game.state).toEqual(before);
  });
});

describe("each installed die rolls for itself (#695 review)", () => {
  it("draws once per die instance, even when two share a definition", async () => {
    const { createPassiveBlock } = await import("../passives");
    const { scoreFieldWithPassives } = await import("../passive-effects");
    const { game, hand } = runWith();
    expect(game.play({ cardId: hand[0]!.id })).not.toBeNull();
    expect(game.play({ cardId: hand[1]!.id, targetId: hand[0]!.id, face: "east" })).not.toBeNull();
    let draws = 0;
    const counting = () => {
      draws += 1;
      return 0.5;
    };
    const dice = [createPassiveBlock("d6", "die.a"), createPassiveBlock("d6", "die.b")];
    scoreFieldWithPassives(game.state.field, dice, undefined, counting);
    expect(draws).toBe(2);
  });
});
