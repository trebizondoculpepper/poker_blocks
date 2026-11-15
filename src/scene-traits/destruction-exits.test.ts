import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { createCard, pokerIdentity, standardDeck, type CardBlock } from "../cards";
import type { EventEnvelope } from "../lifecycle/action";
import type { MaterialDefinition } from "../materials";
import type { RenderedBlock } from "../rendered-blocks";
import { destructionExits, type DestructionExitServices } from "./destruction-exits";

const block = (id: string, kind: string): CardBlock => {
  const card = createCard(pokerIdentity(standardDeck[0]!), id);
  return { ...card, traits: { ...card.traits, material: { kind: kind as never } } };
};

const recipe = { steps: [{ effects: [{ effect: "fade" }] }] };
const definitions: Record<string, MaterialDefinition> = {
  wood: { id: "wood", appearance: { assembly: "sixFaces", exit: recipe } } as never,
  odd: { id: "odd", appearance: { assembly: "noSuchAssembly" } } as never,
};

function harness() {
  const listeners = new Set<(facts: readonly EventEnvelope[]) => void>();
  const board = new THREE.Group();
  const table = new Map<string, RenderedBlock>();
  const released: string[] = [];
  const put = (id: string, kind: string) => {
    const cube = new THREE.Mesh();
    board.add(cube);
    table.set(id, { block: block(id, kind), cube, cell: { x: 1, y: 0, z: 0 } } as never);
  };
  const started: {
    blockId: string;
    root: THREE.Object3D;
    shell: readonly THREE.Object3D[];
    release(): void;
  }[] = [];
  const diagnose = vi.fn();
  const exits = {
    start: vi.fn(
      (
        snapshot: { blockId: string; material?: string },
        visual: { root: THREE.Object3D; shell: readonly THREE.Object3D[]; release(): void },
        _sequence: unknown,
      ) => void started.push({ blockId: snapshot.blockId, ...visual }),
    ),
    prepare: vi.fn((snapshot: { blockId: string }, visual: { release(): void }) => ({
      work: { handler: "block.exit", payload: { id: snapshot.blockId }, dueUnits: 0 },
      abandon: vi.fn(() => visual.release()),
    })),
    dispose: vi.fn(),
  };
  /** The committed action's post-scoring reservation, when the test gives one. */
  let contribution: {
    bind: ReturnType<typeof vi.fn>;
    settleEmpty: ReturnType<typeof vi.fn>;
    observe: ReturnType<typeof vi.fn>;
  } | null = null;
  const composed: string[] = [];
  const services: DestructionExitServices = {
    run: {
      onCommitted(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    field: {
      detach(id) {
        const rendered = table.get(id);
        if (!rendered) return null;
        table.delete(id);
        // The real field releases once however often it is asked (field-view's `detach`).
        let held = true;
        return {
          rendered,
          release: () => {
            if (held) released.push(id);
            held = false;
          },
        };
      },
    },
    exits,
    actionPhase: {
      latest: { generation: 1, actionId: "a" },
      contributionFor: () => contribution as never,
    },
    composeProducer(producer) {
      composed.push(producer);
      return () => void composed.splice(composed.indexOf(producer), 1);
    },
    definitionOf: (each) => definitions[each.traits.material!.kind]!,
    diagnose,
  };
  const commit = (...facts: { type: string; blockId?: string }[]) => {
    for (const listener of listeners)
      listener(
        facts.map((fact) => ({ type: fact.type, payload: fact }) as unknown as EventEnvelope),
      );
  };
  const reserve = (accepts = true) =>
    (contribution = {
      bind: vi.fn(() => accepts),
      settleEmpty: vi.fn(),
      observe: vi.fn(),
    });
  return {
    services,
    put,
    table,
    board,
    started,
    released,
    diagnose,
    exits,
    commit,
    listeners,
    reserve,
    composed,
  };
}

describe("destruction exits (#1173; doc/triggered-presentation.md)", () => {
  it("detaches a removed table block and plays its own captured recipe", () => {
    const h = harness();
    h.put("v1", "wood");
    const trait = destructionExits<never>();
    trait.enter!({ services: h.services } as never, {});
    h.commit({ type: "block.removed", blockId: "v1" });
    expect(h.table.has("v1")).toBe(false);
    expect(h.exits.start).toHaveBeenCalledOnce();
    const [snapshot, visual, sequence] = h.exits.start.mock.calls[0]!;
    expect(snapshot).toEqual({ blockId: "v1", cell: { x: 1, y: 0, z: 0 }, material: "wood" });
    expect(sequence).toBe(recipe);
    expect(visual.shell[0]).toBe(visual.root);
    // The exit owns the visual: releasing it disposes the cube once, through the field.
    visual.release();
    visual.release();
    expect(h.released).toEqual(["v1"]);
  });

  it("ignores other facts and blocks not on the table, and never resurrects one", () => {
    const h = harness();
    h.put("v1", "wood");
    const trait = destructionExits<never>();
    trait.enter!({ services: h.services } as never, {});
    h.commit(
      { type: "block.collected", blockId: "v1" },
      { type: "block.removed", blockId: "hand-card" },
    );
    expect(h.exits.start).not.toHaveBeenCalled();
    expect(h.table.has("v1")).toBe(true);
    h.commit({ type: "block.removed", blockId: "v1" });
    h.commit({ type: "block.removed", blockId: "v1" });
    expect(h.exits.start).toHaveBeenCalledOnce();
  });

  it("reports a look with no exit and lets the block go at once, with no invented breakup", () => {
    const h = harness();
    h.put("x1", "odd");
    const trait = destructionExits<never>();
    trait.enter!({ services: h.services } as never, {});
    const cube = h.table.get("x1")!.cube;
    h.commit({ type: "block.removed", blockId: "x1" });
    expect(h.exits.start).not.toHaveBeenCalled();
    expect(h.diagnose).toHaveBeenCalledWith(expect.stringContaining("no exit for odd"));
    expect(cube.parent).toBeNull();
    expect(h.released).toEqual(["x1"]);
  });

  it("plays each of several victims' exits, of different materials, independently", () => {
    const h = harness();
    definitions.paper = {
      id: "paper",
      appearance: { assembly: "sixFaces", exit: recipe },
    } as never;
    h.put("a", "wood");
    h.put("b", "paper");
    const trait = destructionExits<never>();
    trait.enter!({ services: h.services } as never, {});
    h.commit({ type: "block.removed", blockId: "a" }, { type: "block.removed", blockId: "b" });
    expect(h.started.map(({ blockId }) => blockId)).toEqual(["a", "b"]);
    expect(h.exits.start.mock.calls.map(([snapshot]) => snapshot.material)).toEqual([
      "wood",
      "paper",
    ]);
  });

  it("leaving the scene stops listening and ends every exit it started", () => {
    const h = harness();
    const trait = destructionExits<never>();
    trait.enter!({ services: h.services } as never, {});
    trait.enter!({ services: h.services } as never, {});
    expect(h.listeners.size).toBe(1);
    trait.exit!({ services: h.services } as never, {});
    expect(h.listeners.size).toBe(0);
    expect(h.exits.dispose).toHaveBeenCalledOnce();
  });

  it("binds an action's victims' exits to its post-scoring reservation, together (#1315 review)", () => {
    const h = harness();
    h.put("a", "wood");
    h.put("b", "wood");
    const reservation = h.reserve();
    const trait = destructionExits<never>();
    trait.enter!({ services: h.services } as never, {});
    expect(h.composed).toEqual(["destructionExits"]);
    h.commit({ type: "block.removed", blockId: "a" }, { type: "block.removed", blockId: "b" });
    expect(h.exits.start).not.toHaveBeenCalled();
    expect(reservation.bind).toHaveBeenCalledOnce();
    const work = (reservation.bind.mock.calls as unknown[][])[0]![0] as {
      handler: string;
      payload: { exits: unknown[] };
    };
    expect(work.handler).toBe("destruction.exits");
    expect(work.payload.exits).toHaveLength(2);
    // Cancelled before they started, the blocks are still let go.
    const abandon = (reservation.observe.mock.calls as unknown[][])[0]![0] as () => void;
    abandon();
    expect(h.released).toEqual(["a", "b"]);
    trait.exit!({ services: h.services } as never, {});
    expect(h.composed).toEqual([]);
  });

  it("settles a reservation with no victim to show at once, and lets go if binding is refused", () => {
    const h = harness();
    h.put("x1", "odd");
    const empty = h.reserve();
    const trait = destructionExits<never>();
    trait.enter!({ services: h.services } as never, {});
    h.commit({ type: "block.removed", blockId: "x1" });
    expect(empty.settleEmpty).toHaveBeenCalledOnce();
    h.put("v1", "wood");
    h.reserve(false);
    h.commit({ type: "block.removed", blockId: "v1" });
    expect(h.released).toContain("v1");
  });
});
