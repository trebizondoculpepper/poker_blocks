import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createCard, pokerIdentity, standardDeck, type CardBlock } from "./cards";
import type { CommittedMetadata } from "./command-codecs";
import type { EventEnvelope } from "./lifecycle/action";
import { getMaterialDefinition, type MaterialDefinition } from "./materials";
import { createPlacementPhase, placementProducer, scoringProducer } from "./placement-phase";
import {
  causalSpacingUnits,
  createExplosion,
  defaultExplosion,
  projectTriggered,
  triggeredProducer,
  type ExplosionHost,
  type TriggeredRequest,
} from "./triggered-presentation";
import type { Cell } from "./traits/attachable";
import { createActionPhases } from "./visual-events/action-phases";
import { createVisualScheduler, unitMs } from "./visual-events/scheduler";

const block = (id: string, kind: string): CardBlock => {
  const card = createCard(pokerIdentity(standardDeck[0]!), id);
  return { ...card, traits: { ...card.traits, material: { kind: kind as never } } };
};

let nextEvent = 0;
/** A committed `block.triggered` fact, as src/triggers.ts publishes it. */
function triggered(
  source: CardBlock,
  path: string[],
  cell: Cell | null = { x: 0, y: 0, z: 0 },
  eventId = `e${++nextEvent}`,
) {
  const visited = new Set(path);
  return {
    eventId,
    type: "block.triggered",
    actionId: "a1",
    payload: {
      type: "block.triggered",
      blockId: source.id,
      trigger: {
        cause: "countdown",
        source: { block: source, ...(cell ? { cell } : {}) },
        path,
        visited,
      },
    },
  } as unknown as EventEnvelope;
}

const removed = (id: string) =>
  ({
    eventId: `e${++nextEvent}`,
    type: "block.removed",
    payload: { type: "block.removed", blockId: id },
  }) as unknown as EventEnvelope;

const explosive = { response: "explosion", config: { pop: { circles: 5 } } };
const definitions: Record<string, MaterialDefinition> = {
  bomb: { appearance: { onTrigger: explosive } } as MaterialDefinition,
  relay: { appearance: {} } as MaterialDefinition,
};
const definitionOf = (each: CardBlock) => definitions[each.traits.material!.kind]!;

describe("triggered requests, captured at commit (#1172)", () => {
  it("asks only configured sources to present, never their victims or unconfigured relays", () => {
    const bomb = block("b1", "bomb");
    const relay = block("r1", "relay");
    const second = block("b2", "bomb");
    const requests = projectTriggered(
      [
        triggered(bomb, ["b1"], { x: 1, y: 0, z: 0 }),
        removed("v1"),
        triggered(relay, ["b1", "r1"]),
        triggered(second, ["b1", "r1", "b2"], { x: 3, y: 0, z: 0 }),
      ],
      { definitionOf },
    );
    expect(requests.map(({ sourceId, depth }) => [sourceId, depth])).toEqual([
      ["b1", 0],
      ["b2", 2],
    ]);
    expect(requests[0]).toMatchObject({
      handler: "triggered.explosion",
      cell: { x: 1, y: 0, z: 0 },
    });
    // The response's settings, over the defaults.
    expect((requests[0]!.config as typeof defaultExplosion).pop).toMatchObject({
      circles: 5,
      minCircles: 3,
    });
    // Plain and frozen: no chain state, no live block.
    expect(Object.isFrozen(requests[0])).toBe(true);
    expect(JSON.stringify(requests[0])).not.toContain("visited");
    expect(Object.values(requests[0]!)).not.toContain(bomb);
  });

  it("counts causal depth from the action's first trigger, even one that presents nothing", () => {
    const requests = projectTriggered(
      [
        triggered(block("r1", "relay"), ["r1"]),
        triggered(block("r2", "relay"), ["r1", "r2"]),
        triggered(block("b1", "bomb"), ["r1", "r2", "b1"]),
      ],
      { definitionOf },
    );
    expect(requests.map(({ sourceId, depth }) => [sourceId, depth])).toEqual([["b1", 2]]);
  });

  it("presents a lone source with no neighbours", () => {
    const requests = projectTriggered([triggered(block("b1", "bomb"), ["b1"])], { definitionOf });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.depth).toBe(0);
  });

  it("keeps simultaneous independent sources apart, and a repeated delivery as one", () => {
    const one = triggered(block("b1", "bomb"), ["b1"], { x: 0, y: 0, z: 0 }, "same");
    const requests = projectTriggered(
      [one, one, triggered(block("b2", "bomb"), ["b2"], { x: 0, y: 0, z: 0 })],
      { definitionOf },
    );
    expect(requests.map(({ occurrence }) => occurrence)).toEqual(["same", expect.any(String)]);
    expect(requests.map(({ depth }) => depth)).toEqual([0, 0]);
  });

  it("omits a source with no captured cell, with a diagnostic, rather than inventing one", () => {
    const diagnose = vi.fn();
    const requests = projectTriggered([triggered(block("b1", "bomb"), ["b1"], null)], {
      definitionOf,
      diagnose,
    });
    expect(requests).toEqual([]);
    expect(diagnose).toHaveBeenCalledWith(expect.stringContaining("no captured cell"));
  });

  it("reserves post-scoring only for an action with requests", () => {
    const phases = createActionPhases(createVisualScheduler(), {
      plan: "scoring",
      producers: [triggeredProducer],
    });
    const none = phases.commit("quiet", { factTypes: [], triggered: [] });
    const some = phases.commit("loud", {
      factTypes: [],
      triggered: projectTriggered([triggered(block("b1", "bomb"), ["b1"])], { definitionOf }),
    });
    expect(none.ok && phases.contribution(none.key, triggeredProducer)).toBeNull();
    expect(some.ok && phases.contribution(some.key, triggeredProducer)?.slot).toBe("postScoring");
  });
});

/** A host that records what each explosion does. */
function recordingHost(reducedMotion = false) {
  const log: string[] = [];
  const placed = new Set<THREE.Object3D>();
  const world = new THREE.Group();
  const board = new THREE.Group();
  board.position.set(10, 0, 0);
  world.add(board);
  const host: ExplosionHost = {
    place(object, cell) {
      object.position.set(cell.x, cell.y, cell.z);
      board.add(object);
      placed.add(object);
      log.push(`place ${cell.x}`);
    },
    remove(object) {
      board.remove(object);
      placed.delete(object);
      log.push("remove");
    },
    addToWorld(object) {
      world.add(object);
      log.push("world+");
    },
    removeFromWorld(object) {
      world.remove(object);
      log.push("world-");
    },
    cubeSize: 1,
    flash(at, look) {
      log.push(`flash ${at.x} ${look.circles}`);
    },
    reducedMotion: () => reducedMotion,
    random: () => 0.5,
  };
  return { host, log, placed, world, board };
}

describe("an explosion effect (#1172)", () => {
  const request: TriggeredRequest = {
    occurrence: "e",
    sourceId: "b1",
    cell: { x: 2, y: 0, z: 0 },
    depth: 0,
    handler: "triggered.explosion",
    config: defaultExplosion,
  };

  it("flashes once at its cell in the board's transform, runs its smoke out, and releases once", () => {
    const { host, log, placed } = recordingHost();
    const effect = createExplosion(request, defaultExplosion, host, 0);
    // It pops as it starts. The board sits at x 10: the cell resolves through its transform, and
    // the smoke goes into the world there, not under the board.
    expect(log).toEqual(["place 2", "remove", "world+", "flash 12 6"]);
    expect(effect.update(0)).toBe("running");
    let now = 0;
    let state = "running";
    while (state === "running" && now < 10_000) state = effect.update((now += 50));
    expect(state).toBe("finished");
    const emitAndLife =
      (defaultExplosion.smoke.emitUnits * unitMs) / 1000 + defaultExplosion.smoke.lifetime;
    expect(now / 1000).toBeCloseTo(emitAndLife, 0);
    effect.dispose();
    effect.cancel();
    expect(log.filter((line) => line === "world-")).toHaveLength(1);
    expect(placed.size).toBe(0);
    expect(log.filter((line) => line.startsWith("flash"))).toHaveLength(1);
  });

  it("keeps its smoke in the world: turning the board afterwards never moves it", () => {
    const { host, world, board } = recordingHost();
    const effect = createExplosion(request, defaultExplosion, host, 0);
    const smoke = world.children.find((child) => child !== board)!;
    expect(smoke.parent).toBe(world);
    board.rotation.y = 1;
    board.updateMatrixWorld(true);
    expect(smoke.parent).toBe(world);
    expect(smoke.matrixWorld.equals(new THREE.Matrix4())).toBe(true);
    effect.dispose();
  });

  it("under reduced motion still pops once, softened by the dazzle, and emits no smoke", () => {
    const { host, log } = recordingHost(true);
    const effect = createExplosion(request, defaultExplosion, host, 0);
    expect(effect.update(0)).toBe("finished");
    expect(log.filter((line) => line.startsWith("flash"))).toHaveLength(1);
  });

  it("catches up from its scheduled start after a late frame, never restarting its smoke", () => {
    const { host } = recordingHost();
    const lifetime =
      (defaultExplosion.smoke.emitUnits * unitMs) / 1000 + defaultExplosion.smoke.lifetime;
    // Scheduled at 1000 ms but first updated almost a lifetime later: it is nearly done.
    const effect = createExplosion(request, defaultExplosion, host, 1000);
    expect(effect.update(1000 + lifetime * 1000 - 50)).toBe("running");
    expect(effect.update(1000 + lifetime * 1000 + 50)).toBe("finished");
  });

  it("cancelled, it releases once and finishes", () => {
    const { host, log } = recordingHost();
    const effect = createExplosion(request, defaultExplosion, host, 0);
    effect.cancel();
    effect.dispose();
    expect(effect.update(0)).toBe("finished");
    expect(log.filter((line) => line === "world-")).toHaveLength(1);
  });
});

describe("triggered effects in the committed action's post-scoring phase (#1172)", () => {
  const lent = getMaterialDefinition("wood");
  afterEach(() => void delete lent.appearance.onTrigger);

  function harness() {
    lent.appearance.onTrigger = { response: "explosion" };
    const recorded = recordingHost();
    const scheduler = createVisualScheduler({ services: { triggeredEffects: recorded.host } });
    let now = 0;
    scheduler.update(0, true);
    const step = (ms: number) => {
      for (let t = 0; t < ms; t += 10) scheduler.update((now += 10), true);
    };
    const listeners = new Set<
      (facts: readonly EventEnvelope[], metadata: CommittedMetadata) => void
    >();
    const placement = createPlacementPhase(
      { onCommitted: (listener) => (listeners.add(listener), () => listeners.delete(listener)) },
      createActionPhases(scheduler, {
        plan: "scoring",
        producers: [placementProducer, scoringProducer, triggeredProducer],
      }),
    );
    const commit = (actionId: string, facts: EventEnvelope[]) => {
      for (const listener of listeners) listener(facts, { actionId } as CommittedMetadata);
    };
    return { ...recorded, step, commit, placement, at: () => now };
  }

  it("starts the root when the phase opens and each causal step two units later", () => {
    const { host, log, step, commit, placement, at } = harness();
    const times: number[] = [];
    const flash = host.flash.bind(host);
    host.flash = (point, look) => (times.push(at()), flash(point, look));
    const root = block("b1", "wood");
    const chained = block("b2", "wood");
    commit("a1", [
      triggered(root, ["b1"], { x: 0, y: 0, z: 0 }),
      removed("victim"),
      triggered(chained, ["b1", "b2"], { x: 1, y: 0, z: 0 }),
    ]);
    const key = placement.latest!;
    step(400);
    // The victim never pops; the chained source pops two units after the root, at its own cell.
    expect(log.filter((line) => line.startsWith("flash"))).toEqual(["flash 10 6", "flash 11 6"]);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(causalSpacingUnits * unitMs - 10);
    expect(times[1]! - times[0]!).toBeLessThanOrEqual(causalSpacingUnits * unitMs + 10);
    // The action's full required root waits for both explosions' smoke.
    let settled = false;
    placement.observeAction(key, () => (settled = true));
    step(1000);
    expect(settled).toBe(false);
    step(4000);
    expect(settled).toBe(true);
    expect(log.filter((line) => line === "world-")).toHaveLength(2);
  });

  it("waits for its own action's scoring before any explosion starts", () => {
    const { log, step, commit, placement } = harness();
    commit("a1", [
      { eventId: "s", type: "score.totalApplied", payload: {} } as unknown as EventEnvelope,
      triggered(block("b1", "wood"), ["b1"]),
    ]);
    const scoring = placement.contributionFor(placement.latest!, scoringProducer)!;
    step(500);
    expect(log).toEqual([]);
    scoring.settleEmpty();
    step(30);
    expect(log.filter((line) => line.startsWith("flash"))).toHaveLength(1);
  });

  it("a reset cancels running explosions once and nothing starts after", () => {
    const { log, step, commit, placement } = harness();
    commit("a1", [
      triggered(block("b1", "wood"), ["b1"]),
      triggered(block("b2", "wood"), ["b1", "b2"]),
    ]);
    // Until the root has popped, before the chained one is due.
    for (let i = 0; i < 100 && !log.length; i++) step(10);
    placement.reset();
    step(2000);
    expect(log.filter((line) => line.startsWith("flash"))).toHaveLength(1);
    expect(log.filter((line) => line === "world-")).toHaveLength(1);
  });

  it("an action with no configured source reserves and presents nothing", () => {
    const { log, step, commit, placement } = harness();
    delete lent.appearance.onTrigger;
    commit("a1", [triggered(block("b1", "wood"), ["b1"])]);
    expect(placement.contributionFor(placement.latest!, triggeredProducer)).toBeNull();
    step(500);
    expect(log).toEqual([]);
  });
});

describe("causal steps keep the phase's scheduled timeline (#1294 review)", () => {
  it("dates each request from the dispatch's scheduled time, not a late start", async () => {
    const { visualHandlers } = await import("./visual-events/scheduler");
    const due: number[] = [];
    const requests = [
      { depth: 0, handler: "x", sourceId: "a" },
      { depth: 2, handler: "x", sourceId: "b" },
    ];
    visualHandlers.get("triggered.explosions")({ requests }, {
      nowMs: 900,
      scheduledAtMs: 600,
      scope: {} as never,
      schedule: (description: { dueUnits: number }) => {
        due.push(description.dueUnits);
        return { accepted: true, handle: {} as never };
      },
      cancel: () => {},
      services: {},
    } as never);
    expect(due).toEqual([600 / unitMs, 600 / unitMs + 2 * causalSpacingUnits]);
  });
});
