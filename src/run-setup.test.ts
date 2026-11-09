import { describe, expect, it } from "vite-plus/test";
import { fixedRandom } from "./random";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { makeDevDeck, materialOf } from "./materials";
import { demoRunRules } from "./run-rules";
import { createRunSetupRegistry } from "./run-setup-behaviours";
import {
  RunSetupRegistry,
  type RunDeck,
  type RunSetupServices,
  type RunSetupStep,
} from "./run-setup";
import { gameModeFor } from "./game-modes";
import { fromSaveRecord, toSaveRecord } from "./save";

const services: RunSetupServices = {
  standardDeck,
  newSeed: () => 4201,
  random: () => 0,
};

const noOffers = () => undefined;

/** The deck this mode's run setup deals for a new run. */
function newDeck(steps: readonly RunSetupStep[]): RunDeck {
  return createRunSetupRegistry(noOffers).deck(steps, { deck: standardDeck }, services);
}

/** The rules this mode plays under, new run or resumed. */
function policy(steps: readonly RunSetupStep[]): ReturnType<RunSetupRegistry["policy"]> {
  return createRunSetupRegistry(noOffers).policy(steps, demoRunRules, services);
}

/** A fresh run, exactly as the run controller creates one. */
function freshRun(modeId: string): GameRun {
  const mode = gameModeFor(modeId);
  const registry = createRunSetupRegistry(() => mode.traits.shop);
  const rules = registry.policy(mode.runSetup, demoRunRules, services);
  const dealt = registry.deck(mode.runSetup, { deck: standardDeck }, services);
  const opening = new GameRun(dealerRegistry, rules, dealt.deck, fixedRandom()).snapshot();
  // As the run controller does: the new run records the seed of the deck it was dealt.
  const snapshot = { ...opening, ...(dealt.seed === undefined ? {} : { seed: dealt.seed }) };
  const started = registry.start(mode.runSetup, { rules, deck: dealt, snapshot }, services);
  return GameRun.fromSnapshot(dealerRegistry, rules, dealt.deck, started.snapshot, fixedRandom());
}

describe("run setup registry", () => {
  it("type-checks each step's behaviour against that step's own configuration", () => {
    const registry = new RunSetupRegistry();
    // Named with its step, each behaviour is checked against that step's own configuration.
    registry.register("shopPreview", {
      start: (context, { coins }) => ({
        ...context,
        snapshot: { ...context.snapshot, state: { ...context.snapshot.state, coins } },
      }),
    });
    // A name no step declares is rejected where it is registered.
    const unknownStep = () => {
      // @ts-expect-error "shopStock" is a scene trait, not a run setup step
      registry.register("shopStock", {});
    };
    expect(unknownStep).toBeTypeOf("function");
    expect(registry.has("shopPreview")).toBe(true);
  });

  it("composes each pass in declared order", () => {
    const registry = new RunSetupRegistry();
    const calls: string[] = [];
    registry.register("sandbox", {
      policy: (rules) => (calls.push("sandbox.policy"), rules),
      start: (context) => (calls.push("sandbox.start"), context),
    });
    registry.register("materialSample", {
      policy: (rules) => (calls.push("sample.policy"), rules),
      deck: (context) => (calls.push("sample.deck"), context),
      start: (context) => (calls.push("sample.start"), context),
    });
    const steps: readonly RunSetupStep[] = [{ step: "sandbox" }, { step: "materialSample" }];
    const rules = registry.policy(steps, demoRunRules, services);
    const dealt = registry.deck(steps, { deck: standardDeck }, services);
    const opening = new GameRun(dealerRegistry, rules, dealt.deck, fixedRandom()).snapshot();
    registry.start(steps, { rules, deck: dealt, snapshot: opening }, services);

    expect(calls).toEqual([
      "sandbox.policy",
      "sample.policy",
      "sample.deck",
      "sandbox.start",
      "sample.start",
    ]);
  });

  it("applies only the steps a mode declares, so an empty list changes nothing", () => {
    expect(policy([])).toEqual(demoRunRules);
    expect(newDeck([])).toEqual({ deck: standardDeck });
  });

  it("rejects a step that was never registered", () => {
    const registry = new RunSetupRegistry();
    const unknown = { step: "sandbox" } as RunSetupStep;
    expect(() => registry.policy([unknown], demoRunRules, services)).toThrow(
      /Unknown run setup step/,
    );
  });

  it("refuses to register the same step twice", () => {
    const registry = new RunSetupRegistry();
    registry.register("sandbox", {});
    expect(() => registry.register("sandbox", {})).toThrow(/already registered/);
  });
});

describe("run setup steps", () => {
  it("sandbox makes the run endless without touching the deck", () => {
    expect(policy([{ step: "sandbox" }]).stage(1, "stage-1")).toMatchObject({
      targetScore: 1_000_000,
    });
    expect(newDeck([{ step: "sandbox" }])).toEqual({ deck: standardDeck });
  });

  it("materialDeck deals a material mix and records the seed in the run", () => {
    const dealt = newDeck([{ step: "materialDeck" }]);
    expect(dealt.seed).toBe(4201);
    expect(dealt.deck.map(materialOf)).not.toEqual(standardDeck.map(materialOf));

    // The seed is offered by the service, so another run deals a different mix.
    const other = createRunSetupRegistry(noOffers).deck(
      [{ step: "materialDeck" }],
      { deck: standardDeck },
      { ...services, newSeed: () => 90210 },
    );
    expect(other.seed).toBe(90210);
    expect(other.deck).not.toEqual(dealt.deck);
  });

  it("materialSample starts the run on a structure holding a block of each material", () => {
    const run = freshRun("dev1");
    expect(run.state.field.length).toBeGreaterThan(0);
    expect(run.state.field.length).toBeLessThan(run.state.deck.length);
  });

  it("startingPassives fills the rack the run starts with, with distinct passives", () => {
    const run = freshRun("dev2");
    expect(run.state.passiveRack).toHaveLength(2);
    expect(new Set(run.state.passiveRack.map(({ id }) => id)).size).toBe(2);
    expect(new Set(run.state.passiveRack.map(({ definitionId }) => definitionId)).size).toBe(2);
  });

  it("never fills the rack past the mode's own capacity, whatever a step declares", () => {
    const registry = createRunSetupRegistry(noOffers);
    const steps: readonly RunSetupStep[] = [{ step: "startingPassives", count: 9 }];
    const rules = { ...demoRunRules, rackCapacity: 3 };
    const dealt = registry.deck(steps, { deck: standardDeck }, services);
    const opening = new GameRun(dealerRegistry, rules, dealt.deck, fixedRandom()).snapshot();
    const started = registry.start(steps, { rules, deck: dealt, snapshot: opening }, services);
    expect(started.snapshot.state.passiveRack).toHaveLength(3);
  });

  it("destructibleMix marks its share of the deck without changing which cards exist", () => {
    const mixed = newDeck([
      { step: "materialDeck" },
      { step: "destructibleMix", share: 1, by: ["manual"] },
    ]);
    expect(mixed.deck.map(({ id }) => id)).toEqual(standardDeck.map(({ id }) => id));
    expect(mixed.deck.every(({ traits }) => traits.destructible?.by.includes("manual"))).toBe(true);
    // A share of 0 leaves every card alone.
    const plain = newDeck([{ step: "destructibleMix", share: 0, by: [] }]);
    expect(plain.deck.every(({ traits }) => traits.destructible === undefined)).toBe(true);
  });

  it("shopPreview opens the run in a stocked shop with the step's coins", () => {
    const run = freshRun("dev3");
    expect(run.phase).toBe("shop");
    expect(run.state.coins).toBe(5);
    expect(run.state.shopStock?.length).toBeGreaterThan(0);
  });

  it("leaves the main game untouched", () => {
    const run = freshRun("game");
    expect(run.phase).toBe("stage-1");
    expect(run.state.coins).toBe(0);
    expect(run.state.passiveRack).toEqual([]);
    expect(run.state.field).toEqual([]);
  });
});

describe("Continue never re-applies run setup", () => {
  it("keeps a sandbox in force after a reload, in every later stage of the resumed run", () => {
    // A sandbox is a rule policy the mode always plays under, not only while a run is dealt.
    const rules = policy(gameModeFor("dev1").runSetup);
    expect(rules.stage(2, "stage-1")).toMatchObject({
      targetScore: 1_000_000,
      plays: 1_000_000,
      discards: 1_000_000,
    });
    // A mode that does not sandbox is unaffected.
    expect(policy(gameModeFor("dev3").runSetup).stage(2, "stage-1").plays).toBe(6);
    // It still applies to a resumed run: the saved stage keeps its own counters.
    const run = freshRun("dev1");
    const saved = run.snapshot();
    const record = JSON.parse(JSON.stringify(toSaveRecord(saved)));
    const restored = fromSaveRecord(record, makeDevDeck(saved.seed!), dealerRegistry)!;
    const resumed = GameRun.fromSnapshot(
      dealerRegistry,
      rules,
      makeDevDeck(saved.seed!),
      restored,
      fixedRandom(),
    );
    expect(resumed.state.round.movesLeft).toBe(saved.state.round.movesLeft);
  });

  it("rebuilds a kept material deck from the seed saved in the run", () => {
    const run = freshRun("dev2");
    const saved = run.snapshot();
    expect(saved.seed).toBe(4201);

    // The saved cards come back from the seed alone, with no setup step run.
    const record = JSON.parse(JSON.stringify(toSaveRecord(saved)));
    const restored = fromSaveRecord(record, makeDevDeck(saved.seed!), dealerRegistry)!;

    expect(restored.state.hand.map(materialOf)).toEqual(saved.state.hand.map(materialOf));
    expect(restored.state.deck.map(materialOf)).toEqual(saved.state.deck.map(materialOf));
    expect(restored.seed).toBe(4201);
    const resumed = GameRun.fromSnapshot(
      dealerRegistry,
      demoRunRules,
      makeDevDeck(4201),
      restored,
      fixedRandom(),
    );
    // The cards are rebuilt from the seed, so compare what is persisted, not object identity.
    expect(toSaveRecord(resumed.snapshot())).toEqual(toSaveRecord(saved));
  });

  it("stays identical when the deck pass is asked for a saved run's seed", () => {
    // The same steps rebuild the same deck from a seed, which is what Continue relies on.
    const steps = gameModeFor("dev4").runSetup;
    const dealt = newDeck(steps);
    const rebuilt = createRunSetupRegistry(noOffers).deck(
      steps,
      { deck: standardDeck, seed: dealt.seed },
      services,
    );
    expect(rebuilt.deck.map(({ id }) => id)).toEqual(dealt.deck.map(({ id }) => id));
    expect(rebuilt.seed).toBe(dealt.seed);
  });

  it.each(["dev2", "dev4"])(
    "%s: Continue rebuilds every card's material and trait, not a fresh deal (#76)",
    (modeId) => {
      const steps = gameModeFor(modeId).runSetup;
      const dealt = newDeck(steps);
      // A different fresh seed is on offer, as it always is in the running game.
      const rebuilt = createRunSetupRegistry(noOffers).deck(
        steps,
        { deck: standardDeck, seed: dealt.seed },
        { ...services, newSeed: () => 90210 },
      );
      expect(rebuilt.seed).toBe(dealt.seed);
      expect(rebuilt.deck.map(materialOf)).toEqual(dealt.deck.map(materialOf));
      expect(rebuilt.deck.map(({ traits }) => traits.destructible)).toEqual(
        dealt.deck.map(({ traits }) => traits.destructible),
      );
    },
  );

  it("resolves a save with no seed against the plain deck rather than the last dealt", () => {
    // Old saves are not supported: nothing about a deck lives outside the run, so a save
    // without a seed simply gets the plain deck instead of a mix recovered from storage.
    const run = freshRun("dev0");
    const record = JSON.parse(JSON.stringify(toSaveRecord(run.snapshot())));
    delete record.seed;

    const restored = fromSaveRecord(record, standardDeck, dealerRegistry)!;
    expect(restored.seed).toBeUndefined();
    // The plain deck carries no material traits, so every card reads as the default material.
    expect(new Set(restored.state.hand.map(materialOf))).toEqual(new Set(["paper"]));
    expect(restored.phase).toBe("stage-1");
  });

  it("ignores a corrupt seed rather than refusing the save", () => {
    const run = freshRun("dev0");
    const record = JSON.parse(JSON.stringify(toSaveRecord(run.snapshot())));
    record.seed = "not a seed";
    expect(fromSaveRecord(record, standardDeck, dealerRegistry)?.seed).toBeUndefined();
    record.seed = -1;
    expect(fromSaveRecord(record, standardDeck, dealerRegistry)?.seed).toBeUndefined();
  });
});
