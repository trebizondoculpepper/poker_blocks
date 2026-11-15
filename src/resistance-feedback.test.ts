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
import { createResistanceFeedbackController } from "./resistance-feedback";
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
  const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  cube.position.set(1, 2, 3);
  const diagnostics: string[] = [];
  const controller = createResistanceFeedbackController({
    source: {
      onCommitted(listener) {
        listeners.push(listener);
        return () => listeners.splice(listeners.indexOf(listener), 1);
      },
    },
    scheduler,
    mount: () => (options.mounted === false ? null : cube),
    reducedMotion: () => options.reduced ?? false,
    diagnose: (message) => diagnostics.push(message),
  });
  const resisted = (block: ReturnType<typeof steel>, actionId = "a1") => {
    const facts = [
      {
        type: "block.resisted",
        payload: { blockId: block.id, cause: "explosion", survivor: block },
      },
    ] as unknown as EventEnvelope[];
    for (const listener of listeners.slice()) listener(facts, { actionId } as CommittedMetadata);
  };
  return { controller, cube, step, resisted, diagnostics, listeners };
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

  it("dispose cancels what is playing once, restoring the visual, and ignores later facts", () => {
    const { controller, cube, step, resisted, listeners } = harness();
    resisted(steel());
    step(30);
    controller.dispose();
    controller.dispose();
    expect(overlays(cube)).toBe(0);
    expectHome(cube);
    expect(listeners).toHaveLength(0);
    resisted(steel(), "a2");
    step(100);
    expect(overlays(cube)).toBe(0);
  });
});
