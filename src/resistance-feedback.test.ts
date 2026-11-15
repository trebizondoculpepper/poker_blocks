import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import type { CommittedMetadata } from "./command-codecs";
import type { EventEnvelope } from "./lifecycle/action";
import {
  experimentalMaterials,
  getMaterialDefinition,
  materialDefinitions,
  withMaterial,
  type MaterialDefinition,
} from "./materials";
import { createPlacementPhase, placementProducer, scoringProducer } from "./placement-phase";
import { createResistanceFeedbackController, survivorProducer } from "./resistance-feedback";
import { createActionPhases, createCompletionAdapter } from "./visual-events/action-phases";
import { createVisualScheduler } from "./visual-events/scheduler";

type Listener = (facts: readonly EventEnvelope[], metadata: CommittedMetadata) => void;

function harness(options: { mounted?: boolean; reduced?: boolean } = {}) {
  const scheduler = createVisualScheduler();
  let now = 0;
  scheduler.update(0, true);
  const step = (ms: number) => {
    for (let t = 0; t < ms; t += 10) scheduler.update((now += 10), true);
  };
  const listeners: Listener[] = [];
  const source = {
    onCommitted(listener: Listener) {
      listeners.push(listener);
      return () => void listeners.splice(listeners.indexOf(listener), 1);
    },
  };
  const phases = createActionPhases(scheduler, {
    plan: "scoring",
    producers: [placementProducer, scoringProducer, survivorProducer],
  });
  const phase = createPlacementPhase(source, phases);
  const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  cube.position.set(1, 2, 3);
  const diagnostics: string[] = [];
  const controller = createResistanceFeedbackController({
    source,
    phase,
    mount: () => (options.mounted === false ? null : cube),
    reducedMotion: () => options.reduced ?? false,
    diagnose: (message) => diagnostics.push(message),
  });
  const resisted = (block: ReturnType<typeof steel>, actionId = "a1", extra: string[] = []) => {
    const facts = [
      ...extra.map((type) => ({ type, payload: {} })),
      {
        type: "block.resisted",
        payload: { blockId: block.id, cause: "explosion", survivor: block },
      },
    ] as unknown as EventEnvelope[];
    for (const listener of listeners.slice()) listener(facts, { actionId } as CommittedMetadata);
    return phase.latest!;
  };
  /** That action's scoring narration finished. */
  const scored = (key: ReturnType<typeof resisted>) => {
    const completion = createCompletionAdapter();
    phase.contributionFor(key, scoringProducer)!.bind(completion.work);
    completion.done();
  };
  return { controller, cube, step, resisted, scored, diagnostics, listeners, phases };
}

const steel = () => withMaterial(standardDeck[0]!, getMaterialDefinition("steel"));
const overlays = (cube: THREE.Object3D) => cube.children.length;
const expectHome = (cube: THREE.Object3D) =>
  expect(cube.position.distanceTo(new THREE.Vector3(1, 2, 3))).toBeLessThan(1e-9);

describe("resistance feedback (#1174; doc/triggered-presentation.md)", () => {
  it("every resistant material declares its survivor response or a deliberate no-op", () => {
    const all: readonly MaterialDefinition[] = [...materialDefinitions, ...experimentalMaterials];
    const missing = all
      .filter(({ traits }) => traits.resistant)
      .filter(({ appearance }) => !appearance.survive)
      .map(({ id }) => id);
    expect(missing).toEqual([]);
  });

  it("flashes and shudders a survivor in place, then restores it exactly", () => {
    const { cube, step, resisted } = harness();
    resisted(steel());
    step(30);
    expect(overlays(cube)).toBeGreaterThan(0);
    expect(cube.position.toArray()).not.toEqual([1, 2, 3]);
    step(1000);
    expect(overlays(cube)).toBe(0);
    expectHome(cube);
  });

  it("plays once for a duplicate delivery of the same action's fact", () => {
    const { cube, step, resisted } = harness();
    resisted(steel());
    resisted(steel());
    step(30);
    expect(overlays(cube)).toBe(1);
  });

  it("reports a resistant look with no declared response and plays nothing", () => {
    const { cube, step, resisted, diagnostics } = harness();
    const plain = withMaterial(standardDeck[1]!, getMaterialDefinition("wood"));
    resisted(plain);
    step(100);
    expect(overlays(cube)).toBe(0);
    expect(diagnostics.join()).toMatch(/declares no survivor response/);
  });

  it("reports a survivor with no mounted visual, changing nothing", () => {
    const { step, resisted, diagnostics } = harness({ mounted: false });
    resisted(steel());
    step(100);
    expect(diagnostics.join()).toMatch(/no mounted visual/);
  });

  it("ends at once under reduced motion, leaving the visual untouched", () => {
    const { cube, step, resisted } = harness({ reduced: true });
    resisted(steel());
    step(30);
    expect(overlays(cube)).toBe(0);
    expectHome(cube);
  });

  it("plays after the action's scoring, not before it (#1174 review)", () => {
    const { cube, step, resisted, scored } = harness();
    const key = resisted(steel(), "a1", ["score.totalApplied"]);
    step(100);
    expect(overlays(cube)).toBe(0);
    scored(key);
    step(30);
    expect(overlays(cube)).toBe(1);
  });

  it("a phase reset cancels playing feedback once, restoring the visual", () => {
    const { controller, cube, step, resisted, phases } = harness();
    resisted(steel());
    step(30);
    controller.reset();
    phases.reset();
    expect(overlays(cube)).toBe(0);
    expectHome(cube);
  });

  it("dispose stops listening, once", () => {
    const { controller, cube, step, resisted, listeners } = harness();
    const before = listeners.length;
    controller.dispose();
    controller.dispose();
    // Only the controller's own subscription goes; the action phases keep theirs.
    expect(listeners).toHaveLength(before - 1);
    resisted(steel(), "a2");
    step(100);
    expect(overlays(cube)).toBe(0);
  });

  it("reset cancels what is playing and forgets deliveries: a new run's same IDs play again", () => {
    const { controller, cube, step, resisted, phases } = harness();
    resisted(steel());
    step(30);
    controller.reset();
    phases.reset();
    expect(overlays(cube)).toBe(0);
    expectHome(cube);
    resisted(steel());
    step(30);
    expect(overlays(cube)).toBe(1);
  });

  it("dispose ends feedback already playing, restoring the visual (#1319)", () => {
    const { controller, cube, step, resisted } = harness();
    resisted(steel());
    step(30);
    expect(overlays(cube)).toBe(1);
    controller.dispose();
    expect(overlays(cube)).toBe(0);
    expectHome(cube);
    step(100);
    expectHome(cube);
  });
});
