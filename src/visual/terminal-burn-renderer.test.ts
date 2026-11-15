import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import type { CardBlock } from "../cards";
import type { RenderedBlock } from "../rendered-blocks";
import { createVisualScheduler } from "../visual-events/scheduler";
import { createTerminalBurnRenderer, type CapturedFieldCard } from "./terminal-burn-renderer";
import { startTerminalFieldBurn } from "./terminal-field-burn";

// A captured card's traits may carry functions; nothing here schedules them.
const card = (id: string) =>
  ({ id, traits: { inspectable: { describe: () => id } } }) as unknown as CardBlock;

function harness(options: { adapter?: string } = {}) {
  const released: RenderedBlock[] = [];
  const made: RenderedBlock[] = [];
  const diagnosed: string[] = [];
  const renderer = createTerminalBurnRenderer({
    views: {
      detachedView(block) {
        const cube = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshStandardMaterial(),
        );
        cube.add(new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshStandardMaterial()));
        const view = {
          block,
          cube,
          maskAdapter: options.adapter ?? "chunkSurface",
        } as unknown as RenderedBlock;
        made.push(view);
        return view;
      },
      release: (view) => released.push(view),
    },
    diagnose: (message) => diagnosed.push(message),
  });
  const scheduler = createVisualScheduler({ services: { terminalFieldBurn: renderer } });
  let now = 0;
  scheduler.update(0, true);
  const step = (ms: number) => {
    for (let t = 0; t < ms; t += 10) scheduler.update((now += 10), true);
  };
  const board = new THREE.Group();
  const cards = (count: number): CapturedFieldCard[] =>
    Array.from({ length: count }, (_, index) => ({
      block: card(`c${index}`),
      position: [index * 2, 0, 0],
      quaternion: [0, 0, 0, 1],
    }));
  return { renderer, scheduler, step, board, cards, released, made, diagnosed };
}

describe("terminal-field burn renderer (#1212)", () => {
  it("captures independent ghosts at their poses under one outgoing root", () => {
    const h = harness();
    const ids = h.renderer.capture(h.board, h.cards(3));
    expect(ids).toHaveLength(3);
    const root = h.board.children[0]!;
    expect(root.children.map(({ position }) => position.x)).toEqual([0, 2, 4]);
    // Each ghost is its own detached view of the captured card.
    expect(h.made.map(({ block }) => block.id)).toEqual(["c0", "c1", "c2"]);
    h.renderer.dispose();
    expect(h.board.children).toHaveLength(0);
    expect(h.released).toHaveLength(3);
  });

  it("burns each ghost away through the shared mask, freeing it once, and opens the gate at 80%", () => {
    const h = harness();
    const ids = h.renderer.capture(h.board, h.cards(5));
    const own = h.made.map(({ cube }) => cube.material);
    const burn = startTerminalFieldBurn(h.scheduler, {
      ghostIds: ids,
      random: () => 0.5,
      reducedMotion: false,
      renderer: h.renderer,
    });
    let gate: string | null = null;
    burn.onGate(({ state }) => (gate = state));
    h.step(30);
    // Mid-burn the first ghost in burn order draws through its masked clone, its child too.
    const first = h.made[ids.indexOf(burn.plan.order[0]!)]!;
    expect(first.cube.material).not.toBe(own[h.made.indexOf(first)]);
    expect((first.cube.children[0] as THREE.Mesh).material).not.toBeInstanceOf(Array);
    expect(gate).toBeNull();
    // Starts spread over 12 units (≈ 800 ms), each lasting 6 units (400 ms).
    h.step(1300);
    expect(gate).toBe("finished");
    h.step(400);
    expect(h.released).toHaveLength(5);
    expect(new Set(h.released).size).toBe(5);
    h.renderer.dispose();
    expect(h.released).toHaveLength(5);
  });

  it("shows summaries at once under reduced motion, settling the gate", () => {
    const h = harness();
    const ids = h.renderer.capture(h.board, h.cards(4));
    const burn = startTerminalFieldBurn(h.scheduler, {
      ghostIds: ids,
      random: () => 0.1,
      reducedMotion: true,
      renderer: h.renderer,
    });
    let gate: string | null = null;
    burn.onGate(({ state }) => (gate = state));
    h.step(900);
    expect(gate).toBe("finished");
    expect(h.released).toHaveLength(4);
  });

  it("frees every ghost exactly once when the root is cancelled mid-burn", () => {
    const h = harness();
    const ids = h.renderer.capture(h.board, h.cards(6));
    const burn = startTerminalFieldBurn(h.scheduler, {
      ghostIds: ids,
      random: () => 0.3,
      reducedMotion: false,
      renderer: h.renderer,
    });
    h.step(200);
    burn.cancel();
    h.renderer.dispose();
    expect(h.released).toHaveLength(6);
    expect(new Set(h.released).size).toBe(6);
    // Every mesh has its own material back.
    for (const { cube } of h.made) expect(cube.material).toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  it("never draws an unpairable look whole: it is reported and summarized", () => {
    const h = harness({ adapter: "noSuchAdapter" });
    const ids = h.renderer.capture(h.board, h.cards(1));
    const burn = startTerminalFieldBurn(h.scheduler, {
      ghostIds: ids,
      random: () => 0.3,
      reducedMotion: false,
      renderer: h.renderer,
    });
    let gate: string | null = null;
    burn.onGate(({ state }) => (gate = state));
    h.step(50);
    expect(h.diagnosed[0]).toContain("can't be drawn");
    expect(h.released).toHaveLength(1);
    expect(gate).toBe("finished");
  });
});
