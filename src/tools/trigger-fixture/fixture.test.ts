import { describe, expect, it } from "vite-plus/test";
import { dealerRegistry } from "../../dealer";
import { buildScenario, type ScenarioDefinition } from "../../dev-scenario";
import { gameModeFor } from "../../game-modes";
import type { EventEnvelope } from "../../lifecycle/action";
import {
  blockMaterials,
  getMaterialDefinition,
  materialOf,
  type BlockMaterial,
} from "../../materials";
import { demoRunRules, sandboxRunRules } from "../../run-rules";
import { projectTriggered } from "../../triggered-presentation";
import { resolvedExit } from "../../visual/exit-defaults";
import { devChainDetonatorMaterial, devDetonatorMaterial, installTriggerFixture } from "./fixture";

installTriggerFixture();

/** The fixture mode's own scenario, as dev22 composes it. */
const scenario = (
  gameModeFor("dev22").runSetup.find(({ step }) => step === "devScenario") as {
    scenario: ScenarioDefinition;
  }
).scenario;

/** Build the fixture's trial and make the one play its countdowns wait for. */
function detonate() {
  const built = buildScenario(scenario, {
    dealers: dealerRegistry,
    rules: sandboxRunRules(demoRunRules),
  });
  if (!built.ok) throw new Error(built.diagnostics.join("\n"));
  const { run } = built.trial;
  const before = new Map(run.state.field.map(({ block }) => [block.id, materialOf(block)]));
  const facts: EventEnvelope[] = [];
  run.onCommitted((committed) => facts.push(...committed));
  // The paper block at (-1, 0, 0): its west face is free.
  const paper = run.state.field.find(({ cell }) => cell.x === -1 && cell.y === 0 && cell.z === 0)!;
  const played = run.play({
    cardId: run.state.hand[0]!.id,
    targetId: paper.block.id,
    face: "west",
  });
  return { run, facts, played, before };
}

describe("the real-trigger fixture (#1177; doc/triggered-presentation.md)", () => {
  it("installs its Dev detonators only through the developer tool, uncatalogued and provisional", () => {
    expect(getMaterialDefinition(devDetonatorMaterial as BlockMaterial).releaseStatus).toEqual({
      provisional: {},
    });
    expect(
      getMaterialDefinition(devChainDetonatorMaterial as BlockMaterial).triggerCountdown,
    ).toBeUndefined();
    // Never in the playable catalogue.
    expect(blockMaterials).not.toContain(devDetonatorMaterial);
    // Installing twice changes nothing.
    expect(() => installTriggerFixture()).not.toThrow();
  });

  it("one play sets off the real chain: sources and a secondary pop, victims go, survivors stay", () => {
    const { facts, played, before, run } = detonate();
    expect(played).not.toBeNull();
    const triggered = facts.filter(({ type }) => type === "block.triggered");
    const sources = triggered.map(({ payload }) => {
      const { trigger } = payload as {
        trigger: { source: { block: { id: string } }; path: string[] };
      };
      return { material: before.get(trigger.source.block.id), steps: trigger.path.length };
    });
    // Both countdown detonators fire as roots; the chain detonator only through a blast.
    expect(sources).toEqual(
      expect.arrayContaining([
        { material: devDetonatorMaterial, steps: 1 },
        { material: devDetonatorMaterial, steps: 1 },
        { material: devChainDetonatorMaterial, steps: 2 },
      ]),
    );
    const removed = facts
      .filter(({ type }) => type === "block.removed")
      .map(({ payload }) => before.get((payload as { blockId: string }).blockId));
    // Ordinary neighbours are destroyed; every detonator removes itself.
    expect(removed).toEqual(
      expect.arrayContaining([
        "wood",
        "paper",
        "ice",
        devDetonatorMaterial,
        devChainDetonatorMaterial,
      ]),
    );
    const resisted = facts
      .filter(({ type }) => type === "block.resisted")
      .map(({ payload }) => before.get((payload as { blockId: string }).blockId));
    expect([...resisted].sort((a, b) => String(a).localeCompare(String(b)))).toEqual([
      "gold",
      "steel",
    ]);
    // The survivors are still on the table, with the played card.
    const left = run.state.field.map(({ block }) => materialOf(block));
    expect(left).toEqual(expect.arrayContaining(["gold", "steel"]));
    expect(left).not.toContain(devDetonatorMaterial);
  });

  it("presents only the actual detonations: the lone source too, the secondary one step later, no victim", () => {
    const { facts } = detonate();
    const requests = projectTriggered(facts);
    expect(requests).toHaveLength(3);
    expect(requests.map(({ depth }) => depth).sort((a, b) => a - b)).toEqual([0, 0, 1]);
    // The lone source, five cells away from everything, still pops.
    expect(requests.some(({ cell }) => cell.x === 5)).toBe(true);
  });

  it("audits every installed material's destruction response: an exit, or a declared survival", () => {
    const missing = [...blockMaterials, devDetonatorMaterial, devChainDetonatorMaterial].flatMap(
      (kind) => {
        const definition = getMaterialDefinition(kind as BlockMaterial);
        const exit = resolvedExit(definition.appearance);
        const survives = definition.appearance.survive !== undefined;
        return exit || survives ? [] : [`${kind}: no exit and no survivor response (needs design)`];
      },
    );
    // Reported explicitly, never papered over with an invented breakup.
    expect(missing).toEqual([]);
  });
});
