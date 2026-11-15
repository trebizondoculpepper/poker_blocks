import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import type { CardBlock } from "./cards";
import type { RenderedBlock } from "./rendered-blocks";
import { createTerminalBurnService } from "./terminal-burn-service";
import { createTerminalBurnRenderer } from "./visual/terminal-burn-renderer";
import { createVisualScheduler } from "./visual-events/scheduler";

const card = (id: string) =>
  ({ id, traits: { inspectable: { describe: () => id } } }) as unknown as CardBlock;

function view(block: CardBlock): RenderedBlock {
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  return { block, cube, maskAdapter: "chunkSurface" } as unknown as RenderedBlock;
}

function harness(count: number) {
  const board = new THREE.Group();
  board.position.set(10, 0, 0);
  board.rotation.y = 0.5;
  const table = Array.from({ length: count }, (_, index) => {
    const placed = view(card(`c${index}`));
    placed.cube.position.set(index * 2, 1, 0);
    board.add(placed.cube);
    return placed;
  });
  const released: RenderedBlock[] = [];
  const renderer = createTerminalBurnRenderer({
    views: { detachedView: view, release: (ghost) => released.push(ghost) },
  });
  const scheduler = createVisualScheduler({ services: { terminalFieldBurn: renderer } });
  let now = 0;
  scheduler.update(0, true);
  const step = (ms: number) => {
    for (let t = 0; t < ms; t += 10) scheduler.update((now += 10), true);
  };
  const service = createTerminalBurnService({
    scheduler,
    renderer,
    board,
    field: { blocks: () => table },
    random: () => 0.5,
    reducedMotion: () => false,
  });
  return { board, table, released, step, service };
}

describe("terminal burn service (#946)", () => {
  it("captures the table's cards as ghosts at their board poses, hides the table, opens the gate", () => {
    const h = harness(5);
    let gate: string | null = null;
    h.service.start().onGate(({ state }) => (gate = state));
    const root = h.board.children.find(({ name }) => name === "terminal-field-burn")!;
    // Ghosts sit where the cards stood, relative to the board they keep following.
    expect(root.children.map(({ position }) => position.toArray().map(Math.round))).toEqual(
      h.table.map(({ cube }) => cube.position.toArray()),
    );
    expect(h.table.every(({ cube }) => !cube.visible)).toBe(true);
    h.step(1300);
    expect(gate).toBe("finished");
    h.step(500);
    expect(h.released).toHaveLength(5);
  });

  it("cancels and frees everything when the table resets, mid-burn", () => {
    const h = harness(6);
    h.service.start();
    h.step(200);
    h.service.reset();
    expect(h.released).toHaveLength(6);
    expect(new Set(h.released).size).toBe(6);
    expect(h.board.children.some(({ name }) => name === "terminal-field-burn")).toBe(false);
  });

  it("settles the gate at once with nothing on the table", () => {
    const h = harness(0);
    let gate: string | null = null;
    h.service.start().onGate(({ state }) => (gate = state));
    expect(gate).toBe("finished");
  });
});
