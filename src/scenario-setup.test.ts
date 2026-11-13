import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { ScenarioError, scenarioVersion, type ScenarioDefinition } from "./dev-scenario";
import { GameRun } from "./game-run";
import { demoRunRules, sandboxRunRules } from "./run-rules";
import { createRunSetupRegistry } from "./run-setup-behaviours";
import type { RunSetupServices, RunStartContext } from "./run-setup";
import "./trial-modifiers";

const services: RunSetupServices = {
  standardDeck,
  newSeed: () => 1,
  random: () => 0,
};
const rules = sandboxRunRules(demoRunRules);
const base = (): RunStartContext => ({
  rules,
  deck: { deck: standardDeck },
  snapshot: new GameRun(dealerRegistry, rules, standardDeck, () => 0).snapshot(),
});
const scenario = (steps: ScenarioDefinition["steps"]): ScenarioDefinition => ({
  version: scenarioVersion,
  seed: 11,
  steps: [
    { capability: "devDeck", config: { steps: [{ operation: "standardTemplates", config: {} }] } },
    ...steps,
  ],
});
const start = (definition: ScenarioDefinition, trialId?: string) =>
  createRunSetupRegistry().start(
    [{ step: "devScenario", scenario: definition, ...(trialId ? { trialId } : {}) }],
    base(),
    services,
  );

describe("the devScenario run-setup step (#901)", () => {
  it("prepares a whole session off to the side, not just a snapshot", () => {
    const { prepared, snapshot } = start(
      scenario([
        { capability: "devHand", config: { indices: [0, 1, 2] } },
        {
          capability: "devPassives",
          config: { passives: [{ definitionId: "trial-dense-packing" }] },
        },
      ]),
      "trial-a",
    );
    expect(prepared).toBeDefined();
    expect(snapshot).toEqual(prepared!.run.snapshot());
    expect(prepared!.cards).toHaveLength(52);
    expect(prepared!.rules).toBe(rules);
    expect(prepared!.provenance).toMatchObject({
      trialId: "trial-a",
      scenarioVersion,
      seed: 11,
      actionLog: [],
    });
    expect(prepared!.provenance.initialSnapshot.state.hand).toHaveLength(3);
    expect(prepared!.run.state.passiveRack).toHaveLength(1);
    // The session's stream is the one the run draws from: same seed, same position.
    expect(prepared!.random.seed).toBe(11);
  });

  it("keeps the post-replay stream and log with the session", () => {
    const first = start(scenario([{ capability: "devHand", config: { indices: [0, 1, 2] } }]));
    const cardId = first.prepared!.run.state.hand[0]!.id;
    const { prepared } = start(
      scenario([
        { capability: "devHand", config: { indices: [0, 1, 2] } },
        { capability: "devReplay", config: { commands: [{ command: "play", args: { cardId } }] } },
      ]),
    );
    expect(prepared!.provenance.actionLog).toEqual([{ command: "play", args: { cardId } }]);
    expect(prepared!.provenance.initialSnapshot.state.field).toEqual([]);
    expect(prepared!.run.state.field).toHaveLength(1);
    expect(prepared!.random.cursor).toBeGreaterThanOrEqual(0);
  });

  it("builds the same session from the same definition", () => {
    const definition = scenario([{ capability: "devHand", config: { indices: [4, 5] } }]);
    const a = start(definition).prepared!;
    const b = start(definition).prepared!;
    expect(JSON.stringify(b.run.state)).toBe(JSON.stringify(a.run.state));
    expect(b.random.next()).toBe(a.random.next());
  });

  it("throws the scenario's diagnostics for an invalid definition, preparing nothing", () => {
    expect(() => start({ ...scenario([]), version: 99 })).toThrow(ScenarioError);
  });

  it("leaves ordinary start steps without a prepared session", () => {
    expect(createRunSetupRegistry().start([], base(), services).prepared).toBeUndefined();
  });
});
