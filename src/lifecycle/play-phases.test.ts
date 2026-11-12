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

  it("runs no material steps when no controller is composed onto the playfield", () => {
    const rules = {
      ...sandboxRunRules(demoRunRules),
      playfield: [],
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

describe("play phase review fixes (#682 review)", () => {
  it("refuses to compose a run with an invalid phase configuration", () => {
    const rules = {
      ...sandboxRunRules(demoRunRules),
      playfield: [
        {
          id: "materialEffectsController",
          config: { beforeScore: ["countdown-deductions", "countdown-deductions"], afterScore: [] },
        },
      ],
    };
    expect(() => new GameRun(dealerRegistry, rules, standardDeck, () => 0)).toThrow(/listed twice/);
  });

  it("shows placement and pre-score steps the score from before the play", async () => {
    const { playSteps } = await import("./play-phases");
    const seen: number[] = [];
    if (!playSteps.has("test.score-probe"))
      playSteps.register("test.score-probe", (context) => {
        seen.push(context.target.state.round.score);
        return [];
      });
    const rules = {
      ...sandboxRunRules(demoRunRules),
      playfield: [
        {
          id: "materialEffectsController",
          config: { beforeScore: ["test.score-probe"], afterScore: [] },
        },
      ],
    };
    const { game, hand } = runWith(rules);
    expect(game.play({ cardId: hand[0]!.id })).not.toBeNull();
    // The second play makes a line, so the dealer's provisional score would differ.
    const before = game.state.round.score;
    seen.length = 0;
    expect(game.play({ cardId: hand[1]!.id, targetId: hand[0]!.id, face: "east" })).not.toBeNull();
    expect(game.state.round.score).toBeGreaterThan(before);
    expect(seen).toEqual([before]);
  });
});

describe("material steps come from the composed playfield (#682 review)", () => {
  it("refuses an unknown playfield controller", () => {
    const rules = { ...sandboxRunRules(demoRunRules), playfield: [{ id: "nope", config: {} }] };
    expect(() => new GameRun(dealerRegistry, rules, standardDeck, () => 0)).toThrow(/nope/);
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
    expect(outcome).toBeDefined();
    expect(outcome!.phase).toBe("settle");
    expect(outcome!.batchId).toBe(completed.batchId);
  });
});

describe("event rules run at the play's phase barriers (#682 review)", () => {
  it("commits a passive's play.beforeScore rule before the play scores", async () => {
    const { createPassiveBlock } = await import("../passives");
    const base = createPassiveBlock("scrapper", "phase.1");
    const listener = {
      ...base,
      traits: {
        ...base.traits,
        passive: {
          traitId: "passive.event-rules",
          eventRules: [
            {
              on: "play.beforeScore",
              select: { id: "event-blocks", config: { where: { id: "always", config: {} } } },
              where: { id: "always", config: {} },
              effects: [{ id: "add-coins", config: { amount: 3 } }],
            },
          ],
        },
      },
    };
    const rules = sandboxRunRules(demoRunRules);
    const opening = new GameRun(dealerRegistry, rules, standardDeck, () => 0);
    opening.installPassive(listener);
    const game = GameRun.fromSnapshot(
      dealerRegistry,
      rules,
      standardDeck,
      opening.snapshot(),
      () => 0,
    );
    const coins = game.state.coins;
    const played = game.play({ cardId: game.state.hand[0]!.id });
    expect(game.actionFailure).toBeNull();
    expect(played).not.toBeNull();
    expect(game.state.coins).toBe(coins + 3);
  });
});

describe("phase facts carry what registered selectors read (#682 review)", () => {
  const withRule = async (rule: Record<string, unknown>) => {
    const { createPassiveBlock } = await import("../passives");
    const base = createPassiveBlock("scrapper", "ctx.1");
    const listener = {
      ...base,
      traits: { ...base.traits, passive: { traitId: "passive.event-rules", eventRules: [rule] } },
    } as unknown as typeof base;
    const rules = sandboxRunRules(demoRunRules);
    const opening = new GameRun(dealerRegistry, rules, standardDeck, () => 0);
    opening.installPassive(listener);
    const hand = [standardDeck[0]!, standardDeck[13]!];
    return GameRun.fromSnapshot(
      dealerRegistry,
      rules,
      standardDeck,
      { ...opening.snapshot(), state: { ...opening.state, hand } },
      () => 0,
    );
  };

  it("gives score.lineFinalized the line the scored-line selector reads", async () => {
    const game = await withRule({
      on: "score.lineFinalized",
      select: { id: "scored-line", config: {} },
      where: { id: "line-length", config: { minimum: 2 } },
      effects: [{ id: "add-coins", config: { amount: 4 } }],
    });
    const [first, second] = game.state.hand;
    expect(game.play({ cardId: first!.id })).not.toBeNull();
    const coins = game.state.coins;
    expect(game.play({ cardId: second!.id, targetId: first!.id, face: "east" })).not.toBeNull();
    expect(game.state.coins).toBe(coins + 4);
  });

  it("gives block.placed the block the event-blocks selector reads", async () => {
    const game = await withRule({
      on: "block.placed",
      select: { id: "event-blocks", config: { where: { id: "always", config: {} } } },
      where: { id: "count-at-least", config: { minimum: 1 } },
      effects: [{ id: "add-coins", config: { amount: 2 } }],
    });
    const coins = game.state.coins;
    expect(game.play({ cardId: game.state.hand[0]!.id })).not.toBeNull();
    expect(game.state.coins).toBe(coins + 2);
  });
});

describe("the working aggregate and captured payloads (#682 review)", () => {
  it("lets a score.beforeTotalApplied rule change the play's total, applied once", async () => {
    const { createPassiveBlock } = await import("../passives");
    const base = createPassiveBlock("scrapper", "total.1");
    const listener = {
      ...base,
      traits: {
        ...base.traits,
        passive: {
          traitId: "passive.event-rules",
          eventRules: [
            {
              on: "score.beforeTotalApplied",
              select: { id: "event-blocks", config: { where: { id: "always", config: {} } } },
              where: { id: "always", config: {} },
              effects: [{ id: "add-line-score", config: { amount: 10 } }],
            },
          ],
        },
      },
    } as unknown as typeof base;
    const rules = sandboxRunRules(demoRunRules);
    const opening = new GameRun(dealerRegistry, rules, standardDeck, () => 0);
    opening.installPassive(listener);
    const game = GameRun.fromSnapshot(
      dealerRegistry,
      rules,
      standardDeck,
      opening.snapshot(),
      () => 0,
    );
    const before = game.state.round.score;
    expect(game.play({ cardId: game.state.hand[0]!.id })).not.toBeNull();
    const lines = game.lastScoredLines.reduce((sum, { points }) => sum + points, 0);
    expect(game.state.round.score).toBe(before + lines + 10);
    const applied = game.actionFacts.filter(({ type }) => type === "score.totalApplied");
    expect(applied).toHaveLength(1);
    expect((applied[0]!.payload as { amount: number }).amount).toBe(lines + 10);
  });

  it("delivers placed blocks as frozen copies a listener cannot use to change the model", async () => {
    const { passiveTraits, createPassiveBlock } = await import("../passives");
    let attempted = false;
    if (!passiveTraits.has("test.placed-meddler"))
      passiveTraits.register("test.placed-meddler", {
        id: "test.placed-meddler",
        listensTo: ["block.placed"],
        respond: (_block, event) => {
          const block = event.blocks![0]! as { traits: Record<string, unknown> };
          try {
            block.traits.meddled = true;
          } catch {
            attempted = true;
          }
          return [];
        },
      });
    const base = createPassiveBlock("scrapper", "meddle.1");
    const rules = sandboxRunRules(demoRunRules);
    const opening = new GameRun(dealerRegistry, rules, standardDeck, () => 0);
    opening.installPassive({
      ...base,
      traits: { ...base.traits, passive: { traitId: "test.placed-meddler" } },
    });
    const game = GameRun.fromSnapshot(
      dealerRegistry,
      rules,
      standardDeck,
      opening.snapshot(),
      () => 0,
    );
    const id = game.state.hand[0]!.id;
    expect(game.play({ cardId: id })).not.toBeNull();
    expect(attempted).toBe(true);
    const onField = game.state.field.find(({ block }) => block.id === id)!.block;
    expect((onField.traits as Record<string, unknown>).meddled).toBeUndefined();
  });
});

describe("aggregate ordering and dice (#682 review)", () => {
  it("draws no random value for rules outside the aggregate phase", async () => {
    const { createPassiveBlock } = await import("../passives");
    const { resolveTotalWithPassives } = await import("../passive-effects");
    const die = createPassiveBlock("d6", "die.1");
    const never = () => {
      throw new Error("drew a random value");
    };
    expect(resolveTotalWithPassives(7, [die], never).value).toBe(7);
  });

  it("delivers finalized-score hooks before the total is applied", async () => {
    const { passiveTraits, createPassiveBlock } = await import("../passives");
    const seen: number[] = [];
    let game: GameRun | null = null;
    if (!passiveTraits.has("test.finalized-probe"))
      passiveTraits.register("test.finalized-probe", {
        id: "test.finalized-probe",
        listensTo: ["score.allLinesFinalized"],
        respond: () => {
          seen.push(probe.read());
          return [];
        },
      });
    const probe = { read: () => game!.state.round.score };
    const base = createPassiveBlock("scrapper", "probe.1");
    const rules = sandboxRunRules(demoRunRules);
    const opening = new GameRun(dealerRegistry, rules, standardDeck, () => 0);
    opening.installPassive({
      ...base,
      traits: { ...base.traits, passive: { traitId: "test.finalized-probe" } },
    });
    const hand = [standardDeck[0]!, standardDeck[13]!];
    game = GameRun.fromSnapshot(
      dealerRegistry,
      rules,
      standardDeck,
      { ...opening.snapshot(), state: { ...opening.state, hand } },
      () => 0,
    );
    const [first, second] = hand;
    expect(game.play({ cardId: first!.id })).not.toBeNull();
    const before = game.state.round.score;
    seen.length = 0;
    expect(game.play({ cardId: second!.id, targetId: first!.id, face: "east" })).not.toBeNull();
    expect(game.state.round.score).toBeGreaterThan(before);
    expect(seen).toEqual([before]);
  });
});

describe("aggregate rules: one roll, committed commands (#682 review)", () => {
  const aggregateRun = async (effects: unknown[]) => {
    const { createPassiveBlock } = await import("../passives");
    const base = createPassiveBlock("scrapper", "agg.1");
    const listener = {
      ...base,
      traits: {
        ...base.traits,
        passive: {
          traitId: "passive.event-rules",
          eventRules: [
            {
              on: "score.beforeTotalApplied",
              select: { id: "event-blocks", config: { where: { id: "always", config: {} } } },
              where: { id: "always", config: {} },
              effects,
            },
          ],
        },
      },
    } as unknown as typeof base;
    return listener;
  };

  it("does not resolve an aggregate rule's random value during line scoring", async () => {
    const { scoreFieldWithPassives } = await import("../passive-effects");
    const listener = await aggregateRun([
      { id: "add-line-score", config: { amount: { valueSource: "roll", sides: 6 } } },
    ]);
    const { game, hand } = runWith();
    expect(game.play({ cardId: hand[0]!.id })).not.toBeNull();
    const never = () => {
      throw new Error("drew a random value");
    };
    expect(() =>
      scoreFieldWithPassives(game.state.field, [listener], undefined, never),
    ).not.toThrow();
  });

  it("commits the commands an aggregate rule returns", async () => {
    const listener = await aggregateRun([{ id: "add-coins", config: { amount: 5 } }]);
    const rules = sandboxRunRules(demoRunRules);
    const opening = new GameRun(dealerRegistry, rules, standardDeck, () => 0);
    opening.installPassive(listener);
    const game = GameRun.fromSnapshot(
      dealerRegistry,
      rules,
      standardDeck,
      opening.snapshot(),
      () => 0,
    );
    const coins = game.state.coins;
    expect(game.play({ cardId: game.state.hand[0]!.id })).not.toBeNull();
    expect(game.state.coins).toBe(coins + 5);
  });
});
