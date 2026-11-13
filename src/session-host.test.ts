import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { scenarioVersion, type ScenarioDefinition } from "./dev-scenario";
import { GameRun } from "./game-run";
import { demoRunRules, sandboxRunRules } from "./run-rules";
import { createRunSetupRegistry } from "./run-setup-behaviours";
import type { PreparedSession, RunSetupServices } from "./run-setup";
import { createSessionRequester, type SessionFactoryHost } from "./session-host";
import "./trial-modifiers";

const isolated: RunSetupServices = {
  standardDeck,
  newSeed: () => {
    throw new Error("drew");
  },
  random: () => {
    throw new Error("drew");
  },
};
const rules = sandboxRunRules(demoRunRules);
const host: SessionFactoryHost = {
  prepare: (steps) =>
    createRunSetupRegistry().start(
      steps,
      {
        rules,
        deck: { deck: standardDeck },
        snapshot: new GameRun(dealerRegistry, rules, standardDeck, () => 0).snapshot(),
      },
      isolated,
    ),
};
const scenario = (seed = 5): ScenarioDefinition => ({
  version: scenarioVersion,
  seed,
  steps: [
    { capability: "devDeck", config: { steps: [{ operation: "standardTemplates", config: {} }] } },
    { capability: "devHand", config: { indices: [0, 1, 2, 3, 4] } },
  ],
});

/** A requester whose adoptions are recorded. */
function requester() {
  const adopted: PreparedSession[] = [];
  return { adopted, request: createSessionRequester(host, (prepared) => adopted.push(prepared)) };
}

describe("prepared-session requests (#902)", () => {
  it("adopts a prepared session and reports its provenance", () => {
    const { adopted, request } = requester();
    const result = request({
      requestId: 1,
      factory: "devScenario",
      config: { scenario: scenario(), trialId: "t1" },
    });
    expect(result).toMatchObject({
      ok: true,
      requestId: 1,
      provenance: { trialId: "t1", seed: 5 },
    });
    expect(adopted).toHaveLength(1);
    expect(adopted[0]!.run.state.hand).toHaveLength(5);
  });

  it("refuses a stale or repeated request without adopting it", () => {
    const { adopted, request } = requester();
    request({
      requestId: 2,
      factory: "devScenario",
      config: { scenario: scenario(), trialId: "a" },
    });
    const stale = request({
      requestId: 1,
      factory: "devScenario",
      config: { scenario: scenario(), trialId: "b" },
    });
    expect(stale).toMatchObject({ ok: false, diagnostics: ["request 1 is stale"] });
    expect(adopted).toHaveLength(1);
  });

  it("adopts nothing when preparation fails", () => {
    const { adopted, request } = requester();
    expect(request({ requestId: 1, factory: "nope", config: {} }).ok).toBe(false);
    expect(
      request({
        requestId: 2,
        factory: "devScenario",
        config: { scenario: { ...scenario(), version: 99 }, trialId: "t" },
      }).ok,
    ).toBe(false);
    expect(adopted).toEqual([]);
  });

  it("restarts identically from the same seed, with the session's own stream", () => {
    const { adopted, request } = requester();
    request({
      requestId: 1,
      factory: "devScenario",
      config: { scenario: scenario(9), trialId: "a" },
    });
    request({
      requestId: 2,
      factory: "devScenario",
      config: { scenario: scenario(9), trialId: "b" },
    });
    const [first, second] = adopted;
    expect(JSON.stringify(second!.run.state)).toBe(JSON.stringify(first!.run.state));
    // The adopted stream is the one the run draws from: drawing here moves the run's cursor.
    const before = second!.random.cursor;
    second!.random.next();
    expect(second!.random.cursor).toBe(before + 1);
    expect(second!.random).not.toBe(first!.random);
  });

  it("never draws from the active stream while preparing", () => {
    const { request } = requester();
    // The host's services throw on any draw: a successful request proves none was made.
    expect(
      request({
        requestId: 1,
        factory: "devScenario",
        config: { scenario: scenario(), trialId: "t" },
      }).ok,
    ).toBe(true);
  });
});
