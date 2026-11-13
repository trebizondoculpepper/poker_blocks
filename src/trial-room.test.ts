import { describe, expect, it } from "vite-plus/test";
import { dealerRegistry } from "./dealer";
import { buildScenario } from "./dev-scenario";
import { gameModeFor } from "./game-modes";
import { demoRunRules, sandboxRunRules } from "./run-rules";
import type { BenchScenario } from "./scene-traits/dev-bench-panel";

describe("the dev20 trial room (#905)", () => {
  const mode = gameModeFor("dev20");
  const traits = Object.values(mode.scenes).find((scene) => scene?.traits?.devBenchPanel)!.traits!;
  const scenarios = traits.devBenchPanel!.scenarios as readonly BenchScenario[];

  it("is a console-listed, restartable mode composing the bench panel and readouts", () => {
    expect(mode.id).toBe("dev20");
    expect(mode.traits.console?.name).toBe("dev20");
    expect(mode.traits.restartable).toBeDefined();
    expect(traits.devTrialReadouts).toEqual({});
    expect(scenarios.length).toBeGreaterThan(1);
  });

  it("offers only scenarios that build, each with its seeded hand and trial passive", () => {
    for (const { label, scenario } of scenarios) {
      const result = buildScenario(scenario, {
        dealers: dealerRegistry,
        rules: sandboxRunRules(demoRunRules),
      });
      expect(result.ok, label).toBe(true);
      if (result.ok) expect(result.trial.run.state.hand, label).toHaveLength(8);
    }
  });
});
