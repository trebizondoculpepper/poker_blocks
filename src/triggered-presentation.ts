/**
 * Triggered presentation (#1172; doc/triggered-presentation.md): what a committed action's actual
 * triggers present, such as a detonating block's explosion, drawn from the model's own
 * `block.triggered` facts, never inferred from victims' removals.
 *
 * - **Configured response.** A definition composes a registered on-trigger presentation response
 *   (`appearance.onTrigger`, `onTriggerResponses`), independently of its model
 *   `triggerable.responses`. A triggered block whose definition composes none presents nothing of
 *   its own; ordinary victims, which are removed rather than triggered, never pop.
 * - **Captured at commit.** `projectTriggered` turns an action's committed facts into plain,
 *   immutable requests: the occurrence (the fact's own id, so simultaneous independent sources
 *   stay independent and a repeated delivery is one request), the source's id and captured cell,
 *   its causal depth in the action and the effect handler and settings. It copies nothing else:
 *   not the chain's visited set, not the live block. A source with no captured cell is omitted with
 *   a diagnostic rather than given an invented origin.
 * - **Post-score, source first.** The `triggeredPresentation` producer reserves the action's
 *   post-scoring contribution for actions with requests; the committed-action controller binds it
 *   at once (`triggeredWork`). When the phase opens, `triggered.explosions` schedules each request
 *   on the shared scheduler in stable fact order, the root at once and each causal step two
 *   game-time units later (`causalSpacingUnits`). Nothing later reads the field or decides a
 *   detonation: the model already did.
 * - **The effect** (`triggered.explosion`) is one dazzle flash, whose pop is the registered sound
 *   played once by the flash itself, and a finite smoke burst in world space, both at the captured
 *   cell resolved through the board's presentation transform as the effect starts, so it is where
 *   the board now shows that cell and survives the source's own removal. It runs on the scheduler's clock, ends when its smoke has gone, and
 *   cancels or disposes its own resources exactly once. Reduced motion is the dazzle's and the
 *   burst's own softened response.
 */
import * as THREE from "three";
import { Registry } from "./core/registry";
import type { EventEnvelope } from "./lifecycle/action";
import { getMaterialDefinition, materialOf, type MaterialDefinition } from "./materials";
import type { GameEvent } from "./passives";
import type { CardBlock } from "./cards";
import type { Cell } from "./traits/attachable";
import { phaseProducers, type Reservation } from "./visual-events/action-phases";
import {
  unitMs,
  visualHandlers,
  type EffectHandle,
  type EventDescription,
} from "./visual-events/scheduler";
import type { DazzleLook } from "./visual/dazzle";
import { createSmokeBurst, type SmokeBurstConfig } from "./visual/smoke";

/** The committed fact a trigger publishes (src/triggers.ts). */
export const triggeredFact = "block.triggered";

/** Game-time units between one causal step's explosion and the next's. */
export const causalSpacingUnits = 2;

/** One actual trigger as an on-trigger response sees it: captured, plain. */
export type TriggerOccurrence = Readonly<{
  sourceId: string;
  cell: Readonly<Cell>;
  path: readonly string[];
}>;

/** The effect a response asks for: a registered visual handler and its settings. */
export type TriggeredEffect = Readonly<{ handler: string; config: unknown }>;

/** A registered on-trigger presentation response: what this occurrence presents, or nothing. */
export type OnTriggerResponse = {
  request(config: unknown, occurrence: TriggerOccurrence): TriggeredEffect | null;
};
export const onTriggerResponses = new Registry<OnTriggerResponse>("on-trigger response");

/** One captured request: everything its effect needs, and nothing live. */
export type TriggeredRequest = Readonly<{
  occurrence: string;
  sourceId: string;
  cell: Readonly<Cell>;
  /** Causal steps after the action's first source. */
  depth: number;
  handler: string;
  config: unknown;
}>;

type Projection = {
  definitionOf?: (block: CardBlock) => MaterialDefinition;
  diagnose?: (message: string) => void;
};

/** An action's committed facts to its triggered requests, in stable fact order. */
export function projectTriggered(
  facts: readonly EventEnvelope[],
  {
    definitionOf = (block) => getMaterialDefinition(materialOf(block)),
    diagnose = (message) => console.warn(message),
  }: Projection = {},
): TriggeredRequest[] {
  const found = new Map<string, Omit<TriggeredRequest, "depth"> & { steps: number }>();
  // The action's first trigger, presenting or not: depth counts every causal step from it,
  // relays and unconfigured roots included (doc/triggered-presentation.md).
  let root = Infinity;
  for (const fact of facts) {
    if (fact.type !== triggeredFact) continue;
    const { trigger } = fact.payload as GameEvent;
    if (!trigger) continue;
    root = Math.min(root, trigger.path.length);
    if (found.has(fact.eventId)) continue;
    const { block, cell } = trigger.source;
    const configured = definitionOf(block).appearance.onTrigger;
    if (!configured) continue;
    if (!cell) {
      diagnose(`triggered ${block.id} has no captured cell: its presentation is omitted`);
      continue;
    }
    const occurrence: TriggerOccurrence = {
      sourceId: block.id,
      cell: { ...cell },
      path: [...trigger.path],
    };
    const effect = onTriggerResponses
      .get(configured.response)
      .request(configured.config, occurrence);
    if (!effect) continue;
    found.set(fact.eventId, {
      occurrence: fact.eventId,
      sourceId: block.id,
      cell: occurrence.cell,
      steps: trigger.path.length,
      handler: effect.handler,
      config: effect.config,
    });
  }
  const requests = [...found.values()];
  return requests.map(({ steps, ...request }) =>
    Object.freeze({ ...request, depth: steps - root }),
  );
}

/** What the committed-action controller captures for this producer. */
export type TriggeredCapture = { triggered: readonly TriggeredRequest[] };

/** The producer: an action with requests reserves its post-scoring contribution. */
export const triggeredProducer = "triggeredPresentation";
phaseProducers.register(triggeredProducer, {
  reserve: (captured: unknown): Reservation =>
    (captured as TriggeredCapture).triggered.length ? { slot: "postScoring" } : null,
});

/** The work its contribution binds: the captured requests, scheduled when the phase opens. */
export function triggeredWork(requests: readonly TriggeredRequest[]): EventDescription {
  return { handler: "triggered.explosions", payload: { requests }, dueUnits: 0 };
}

visualHandlers.register("triggered.explosions", (payload, context) => {
  const { requests } = payload as { requests: readonly TriggeredRequest[] };
  // From the phase's own scheduled start, so a dispatch the scheduler's budget delayed keeps the
  // shared timeline rather than pushing every causal step later (#1294 review).
  const now = context.scheduledAtMs / unitMs;
  for (const request of requests) {
    const admitted = context.schedule({
      handler: request.handler,
      payload: request,
      dueUnits: now + request.depth * causalSpacingUnits,
    });
    if (!admitted.accepted)
      console.warn(`triggered ${request.sourceId} not presented: ${admitted.reason}`);
  }
  return "done";
});

/** An explosion's settings: its pop (one dazzle flash) and its smoke. */
export type ExplosionConfig = {
  pop: Pick<DazzleLook, "minCircles" | "circles" | "spread" | "colours">;
  smoke: SmokeBurstConfig;
};

/**
 * Initial, auditionable defaults (#510): three to six white-centred, yellow-fringed circles and a
 * short grey burst.
 */
export const defaultExplosion: ExplosionConfig = {
  pop: {
    minCircles: 3,
    circles: 6,
    spread: 0.12,
    colours: { centre: "#ffffff", fringe: "rgb(255, 214, 72)" },
  },
  smoke: {
    colour: 0x5e5955,
    size: 0.45,
    frequency: 30,
    rise: 0.8,
    lifetime: 1.8,
    turbulence: 0.25,
    opacity: 0.55,
    emitUnits: 4,
  },
};

onTriggerResponses.register("explosion", {
  request(raw) {
    const config = (raw ?? {}) as Partial<ExplosionConfig>;
    return {
      handler: "triggered.explosion",
      config: {
        pop: { ...defaultExplosion.pop, ...config.pop },
        smoke: { ...defaultExplosion.smoke, ...config.smoke },
      } satisfies ExplosionConfig,
    };
  },
});

/** What an explosion draws through: the board's presentation transform and the dazzle. */
export type ExplosionHost = {
  /** Put an object at a cell of the board, moving with it; `remove` takes it away. */
  place(object: THREE.Object3D, cell: Cell): void;
  remove(object: THREE.Object3D): void;
  /** Put an object in the world (the scene itself), and take it out: smoke rises along world up. */
  addToWorld(object: THREE.Object3D): void;
  removeFromWorld(object: THREE.Object3D): void;
  /** One cell's edge, in board units. */
  readonly cubeSize: number;
  /** One dazzle flash at a world point: it plays its registered pop once. */
  flash(at: THREE.Vector3, look: Partial<DazzleLook>): void;
  reducedMotion(): boolean;
  /** Cosmetic randomness only, never the run's stream. */
  random(): number;
};

export type TriggeredEffectServices = { triggeredEffects: ExplosionHost };

/** One explosion's effect, at its captured cell. */
export function createExplosion(
  request: TriggeredRequest,
  config: ExplosionConfig,
  host: ExplosionHost,
  /** When it was scheduled to start: a late frame catches up from here, never restarts. */
  startedAtMs: number,
): EffectHandle {
  // The captured cell, resolved through the board's presentation transform to where it is now.
  const anchor = new THREE.Group();
  host.place(anchor, request.cell);
  anchor.updateWorldMatrix(true, false);
  const at = anchor.getWorldPosition(new THREE.Vector3());
  host.remove(anchor);
  // The smoke lives in the world, emitting from there: its puffs rise along world up and stay put
  // however the board turns afterwards (doc/game-architecture.md, smoke).
  const smoke = createSmokeBurst(
    config.smoke,
    { random: () => host.random(), size: host.cubeSize },
    at,
  );
  let last = startedAtMs;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    host.removeFromWorld(smoke.object);
    smoke.dispose();
  };
  // It pops as it starts, when the scheduler starts it, not a frame later.
  host.addToWorld(smoke.object);
  host.flash(at, config.pop);
  return {
    update(nowMs) {
      if (released) return "finished";
      const delta = Math.max(0, nowMs - last) / 1000;
      last = nowMs;
      return smoke.update(delta, host.reducedMotion()) ? "running" : "finished";
    },
    cancel: release,
    dispose: release,
  };
}

visualHandlers.register("triggered.explosion", (payload, context) => {
  const request = payload as TriggeredRequest;
  const { triggeredEffects } = context.services as TriggeredEffectServices;
  return createExplosion(
    request,
    request.config as ExplosionConfig,
    triggeredEffects,
    context.scheduledAtMs,
  );
});
