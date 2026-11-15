import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import type { CardBlock } from "./cards";
import type { CommittedMetadata } from "./command-codecs";
import type { EventEnvelope } from "./lifecycle/action";
import {
  materialTransitionHandlers,
  type MaterialTransitionServices,
} from "./material-transitions";
import { createPlacementPhase, scoringProducer } from "./placement-phase";
import type { RenderedBlock } from "./rendered-blocks";
import { materialTransitions } from "./scene-traits/material-transitions";
import { createActionPhases } from "./visual-events/action-phases";
import { createVisualScheduler, visualHandlers } from "./visual-events/scheduler";

type Host = MaterialTransitionServices["materialTransitions"];
type Listener = (facts: readonly EventEnvelope[], metadata: CommittedMetadata) => void;

// A real card's traits carry functions (a scheduled payload may not), as this one does (#1167).
const card = (id: string, material: string) =>
  ({ id, material, traits: { inspectable: { describe: () => material } } }) as unknown as CardBlock;

/** A table block's view: a cube whose own chunk materials the mask adapts. */
function view(block: CardBlock): RenderedBlock {
  const material = new THREE.MeshStandardMaterial();
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  return { block, cube, maskAdapter: "chunkSurface" } as unknown as RenderedBlock;
}

// A stand-in for an action's scoring narration: it takes `ms`.
if (!visualHandlers.has("test.scoring"))
  visualHandlers.register("test.scoring", (payload, context) => {
    const ends = context.scheduledAtMs + (payload as { ms: number }).ms;
    return {
      update: (now) => (now >= ends ? "finished" : "running"),
      cancel() {},
      dispose() {},
    };
  });

function harness() {
  const board = new THREE.Group();
  const table = new Map<string, RenderedBlock>();
  const released: RenderedBlock[] = [];
  const made: RenderedBlock[] = [];
  const diagnosed: string[] = [];
  const host: Host = {
    block: (id) => table.get(id) ?? null,
    detachedView(block) {
      const ghost = view(block);
      made.push(ghost);
      return ghost;
    },
    release: (ghost) => released.push(ghost),
    reducedMotion: () => false,
    diagnose: (message) => diagnosed.push(message),
  };
  const scheduler = createVisualScheduler({ services: { materialTransitions: host } });
  let now = 0;
  scheduler.update(0, true);
  const step = (ms: number) => {
    for (let t = 0; t < ms; t += 10) scheduler.update((now += 10), true);
  };
  const place = (block: CardBlock) => {
    const rendered = view(block);
    rendered.cube.position.set(3, 0, 1);
    board.add(rendered.cube);
    table.set(block.id, rendered);
    return rendered;
  };
  const listeners: Listener[] = [];
  const run = {
    onCommitted(listener: Listener) {
      listeners.push(listener);
      return () => void listeners.splice(listeners.indexOf(listener), 1);
    },
  };
  const phases = createActionPhases(scheduler, { plan: "scoring", producers: [scoringProducer] });
  const actionPhase = createPlacementPhase(run, phases);
  let nextEvent = 0;
  let nextAction = 0;
  /** Commit one action: its facts in order, `change` standing for each material change. */
  const commit = (
    facts: readonly (
      | { change: string; before: CardBlock; extra?: object; eventId?: string }
      | { scored: number }
    )[],
  ) => {
    const actionId = `a${++nextAction}`;
    const envelopes = facts.map(
      (fact) =>
        ({
          eventId: "change" in fact ? (fact.eventId ?? `e${++nextEvent}`) : `e${++nextEvent}`,
          type: "change" in fact ? "block.materialChanged" : "score.totalApplied",
          payload:
            "change" in fact
              ? {
                  blockId: fact.change,
                  snapshots: { before: fact.before, after: card(fact.change, "after") },
                  ...fact.extra,
                }
              : { amount: 1 },
        }) as unknown as EventEnvelope,
    );
    for (const listener of listeners.slice())
      listener(envelopes, { actionId } as unknown as CommittedMetadata);
    // Its scoring narration, where it scored.
    const key = actionPhase.latest;
    const scoring = key && actionPhase.contributionFor(key, scoringProducer);
    const ms = facts.flatMap((fact) => ("scored" in fact ? [fact.scored] : []))[0];
    if (scoring && ms !== undefined)
      scoring.bind({ handler: "test.scoring", payload: { ms }, dueUnits: 0 });
  };
  const trait = materialTransitions<{
    services: {
      run: typeof run;
      visualEvents: typeof scheduler;
      actionPhase: typeof actionPhase;
      composeProducer(producer: string): () => void;
    };
  }>();
  const context = {
    services: {
      run,
      visualEvents: scheduler,
      actionPhase,
      composeProducer: (producer: string) => phases.compose(producer),
    },
  };
  return { board, table, released, made, diagnosed, step, place, commit, trait, context };
}

const settings = { durationUnits: 7.5, reducedDurationUnits: 1.8 };

describe("material transitions (#1167)", () => {
  it("holds the old look from the first frame, then dissolves it into the block's own, following it", () => {
    const h = harness();
    const block = h.place(card("a", "water"));
    const own = block.cube.material;
    h.trait.enter!(h.context as never, settings);
    h.commit([{ change: "a", before: card("a", "ice") }]);
    h.step(20);
    const ghost = h.made[0]!;
    expect(ghost.block).toMatchObject({ material: "ice" });
    const mount = ghost.cube.parent!;
    expect(mount.position.toArray()).toEqual([3, 0, 1]);
    expect(block.cube.material).not.toBe(own);
    block.cube.position.set(4, 0, 1);
    h.step(100);
    expect(mount.position.x).toBe(4);
    h.step(600);
    // Finished (7.5 units, 500 ms): its own materials back, the ghost freed and gone.
    expect(block.cube.material).toBe(own);
    expect(h.released).toEqual([ghost]);
    expect(mount.parent).toBeNull();
    h.trait.exit!(h.context as never, settings);
  });

  it("waits for its action's post-score phase when committed after the score, holding the old look", () => {
    const h = harness();
    const block = h.place(card("a", "water"));
    const own = block.cube.material;
    h.trait.enter!(h.context as never, settings);
    // Scored first (narration 400 ms), then the after-score reaction changed the block.
    h.commit([{ scored: 400 }, { change: "a", before: card("a", "ice") }]);
    h.step(300);
    // Held: the old look over the masked block, not yet dissolving.
    expect(h.made).toHaveLength(1);
    expect(block.cube.material).not.toBe(own);
    expect(h.released).toHaveLength(0);
    h.step(400);
    // The scoring narration settled at 400 ms; 7.5 units on, it has dissolved.
    expect(h.released).toHaveLength(0);
    h.step(500);
    expect(h.released).toHaveLength(1);
    expect(block.cube.material).toBe(own);
  });

  it("plays a pre-score change at once, alongside its action's scoring", () => {
    const h = harness();
    h.place(card("a", "water"));
    h.trait.enter!(h.context as never, settings);
    h.commit([{ change: "a", before: card("a", "ice") }, { scored: 2000 }]);
    h.step(600);
    expect(h.released).toHaveLength(1);
  });

  it("lets a newer change replace one still running, from that change's own old card", () => {
    const h = harness();
    const block = h.place(card("a", "water"));
    const own = block.cube.material;
    h.trait.enter!(h.context as never, settings);
    h.commit([{ change: "a", before: card("a", "ice") }]);
    h.step(100);
    h.commit([{ change: "a", before: card("a", "water") }]);
    h.step(20);
    expect(h.released).toEqual([h.made[0]]);
    expect(h.made[1]!.block).toMatchObject({ material: "water" });
    h.step(700);
    expect(h.released).toEqual([h.made[0], h.made[1]]);
    expect(block.cube.material).toBe(own);
  });

  it("shows each committed fact once, and nothing for a block not on the table", () => {
    const h = harness();
    h.place(card("a", "water"));
    h.trait.enter!(h.context as never, settings);
    h.commit([{ change: "a", before: card("a", "ice"), eventId: "same" }]);
    h.commit([{ change: "a", before: card("a", "ice"), eventId: "same" }]);
    h.commit([{ change: "hand-card", before: card("hand-card", "ice") }]);
    h.step(20);
    expect(h.made).toHaveLength(1);
  });

  it("ends at once when the block is removed or redrawn, and when the scene leaves", () => {
    const h = harness();
    const block = h.place(card("a", "water"));
    h.trait.enter!(h.context as never, settings);
    h.commit([{ change: "a", before: card("a", "ice") }]);
    h.step(50);
    h.table.delete("a");
    h.step(20);
    expect(h.released).toEqual([h.made[0]]);
    h.table.set("a", block);
    h.commit([{ change: "a", before: card("a", "ice") }]);
    h.step(50);
    h.trait.exit!(h.context as never, settings);
    expect(h.released).toEqual([h.made[0], h.made[1]]);
  });

  it("chooses the action's own transition, then the scene's, then perlinDissolve", () => {
    const h = harness();
    h.place(card("a", "water"));
    h.place(card("b", "water"));
    const chosen: string[] = [];
    for (const name of ["testScene", "testAction"])
      if (!materialTransitionHandlers.has(name))
        materialTransitionHandlers.register(name, () => {
          chosen.push(name);
          return null;
        });
    h.trait.enter!(h.context as never, { handler: "testScene" });
    h.commit([{ change: "a", before: card("a", "ice") }]);
    h.commit([
      {
        change: "b",
        before: card("b", "ice"),
        extra: { materialTransition: { handler: "testAction" } },
      },
    ]);
    h.step(20);
    expect(chosen).toEqual(["testScene", "testAction"]);
  });

  it("reports a look the mask can't pair and simply shows the new one", () => {
    const h = harness();
    const block = h.place(card("a", "water"));
    (block as { maskAdapter?: string }).maskAdapter = undefined;
    h.trait.enter!(h.context as never, settings);
    h.commit([{ change: "a", before: card("a", "ice") }]);
    h.step(20);
    expect(h.diagnosed[0]).toContain("not shown");
    expect(h.released).toHaveLength(1);
  });
});
