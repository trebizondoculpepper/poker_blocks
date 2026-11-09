import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { makeDevDeck, materialOf } from "./materials";
import { demoRunRules } from "./run-rules";
import { createRunSetupRegistry } from "./run-setup-behaviours";
import {
  RunSetupRegistry,
  rulesForRun,
  type RunPrepareContext,
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

function prepared(steps: readonly RunSetupStep[]): RunPrepareContext {
  return createRunSetupRegistry(() => gameModeFor(null).traits.shop).prepare(
    steps,
    { rules: demoRunRules, deck: standardDeck },
    services,
  );
}

/** A fresh run, exactly as the run controller creates one. */
function freshRun(modeId: string): GameRun {
  const mode = gameModeFor(modeId);
  const registry = createRunSetupRegistry(() => mode.traits.shop);
  const prep = registry.prepare(
    mode.runSetup,
    { rules: demoRunRules, deck: standardDeck },
    services,
  );
  const rules = prep.rules;
  const opening = new GameRun(dealerRegistry, rules, prep.deck).snapshot();
  const started = registry.start(mode.runSetup, { prepare: prep, snapshot: opening }, services);
  return GameRun.fromSnapshot(dealerRegistry, rules, prep.deck, started.snapshot);
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

  it("composes prepare steps in declared order, then start steps in the same order", () => {
    const registry = new RunSetupRegistry();
    const calls: string[] = [];
    registry.register("sandbox", {
      prepare: (context) => {
        calls.push("sandbox.prepare");
        return context;
      },
      start: (context) => {
        calls.push("sandbox.start");
        return context;
      },
    });
    registry.register("materialSample", {
      prepare: (context) => {
        calls.push("sample.prepare");
        return context;
      },
      start: (context) => {
        calls.push("sample.start");
        return context;
      },
    });
    const steps: readonly RunSetupStep[] = [{ step: "sandbox" }, { step: "materialSample" }];
    const prep = registry.prepare(steps, { rules: demoRunRules, deck: standardDeck }, services);
    const opening = new GameRun(dealerRegistry, prep.rules, prep.deck).snapshot();
    registry.start(steps, { prepare: prep, snapshot: opening }, services);

    expect(calls).toEqual(["sandbox.prepare", "sample.prepare", "sandbox.start", "sample.start"]);
  });

  it("applies only the steps a mode declares, so an empty list changes nothing", () => {
    const bare = prepared([]);
    expect(bare.rules).toEqual(demoRunRules);
    expect(bare.deck).toBe(standardDeck);
    expect(bare.seed).toBeUndefined();
  });

  it("rejects a step that was never registered", () => {
    const registry = new RunSetupRegistry();
    const unknown = { step: "sandbox" } as RunSetupStep;
    expect(() =>
      registry.prepare([unknown], { rules: demoRunRules, deck: standardDeck }, services),
    ).toThrow(/Unknown run setup step/);
  });

  it("refuses to register the same step twice", () => {
    const registry = new RunSetupRegistry();
    registry.register("sandbox", {});
    expect(() => registry.register("sandbox", {})).toThrow(/already registered/);
  });
});

describe("run setup steps", () => {
  it("sandbox makes the run endless without touching the deck", () => {
    const sandboxed = prepared([{ step: "sandbox" }]);
    expect(sandboxed.rules.stage(1, "stage-1")).toMatchObject({ targetScore: 1_000_000 });
    expect(sandboxed.deck).toBe(standardDeck);
  });

  it("materialDeck deals a material mix and records the seed in the run", () => {
    const dealt = prepared([{ step: "materialDeck" }]);
    expect(dealt.seed).toBe(4201);
    expect(dealt.deck.map(materialOf)).not.toEqual(standardDeck.map(materialOf));

    // The seed is offered by the service, so the next run deals a different mix.
    const other = createRunSetupRegistry(() => undefined).prepare(
      [{ step: "materialDeck" }],
      { rules: demoRunRules, deck: standardDeck },
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
    const mode = gameModeFor("dev2");
    const registry = createRunSetupRegistry(() => mode.traits.shop);
    const steps: readonly RunSetupStep[] = [{ step: "startingPassives", count: 9 }];
    const rules = { ...demoRunRules, rackCapacity: 3 };
    const prep = registry.prepare(steps, { rules, deck: standardDeck }, services);
    const opening = new GameRun(dealerRegistry, rules, prep.deck).snapshot();
    const started = registry.start(
      steps,
      { prepare: { ...prep, rules }, snapshot: opening },
      services,
    );
    expect(started.snapshot.state.passiveRack).toHaveLength(3);
  });

  it("destructibleMix marks its share of the deck without changing which cards exist", () => {
    const mixed = prepared([
      { step: "materialDeck" },
      { step: "destructibleMix", share: 1, by: ["manual"] },
    ]);
    expect(mixed.deck.map(({ id }) => id)).toEqual(standardDeck.map(({ id }) => id));
    expect(mixed.deck.every(({ traits }) => traits.destructible?.by.includes("manual"))).toBe(true);
    // A share of 0 leaves every card alone.
    const plain = prepared([{ step: "destructibleMix", share: 0, by: [] }]);
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
    const rules = rulesForRun(gameModeFor("dev1").runSetup, demoRunRules);
    expect(rules.stage(2, "stage-1")).toMatchObject({
      targetScore: 1_000_000,
      plays: 1_000_000,
      discards: 1_000_000,
    });
    // A mode that does not sandbox is unaffected.
    expect(rulesForRun(gameModeFor("dev3").runSetup, demoRunRules).stage(2, "stage-1").plays).toBe(
      6,
    );
    // It still applies to a resumed run: the saved stage keeps its own counters.
    const run = freshRun("dev1");
    const saved = run.snapshot();
    const record = JSON.parse(JSON.stringify(toSaveRecord(saved)));
    const restored = fromSaveRecord(record, makeDevDeck(saved.seed!), dealerRegistry)!;
    const resumed = GameRun.fromSnapshot(dealerRegistry, rules, makeDevDeck(saved.seed!), restored);
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
    const resumed = GameRun.fromSnapshot(dealerRegistry, demoRunRules, makeDevDeck(4201), restored);
    // The cards are rebuilt from the seed, so compare what is persisted, not object identity.
    expect(toSaveRecord(resumed.snapshot())).toEqual(toSaveRecord(saved));
  });

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
