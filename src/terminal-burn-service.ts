/**
 * The terminal-field burn service (#946; doc/loss-field-burn.md): captures the table's final cards
 * as independent ghosts (the #1212 renderer), hides the table's own views behind them, and starts
 * the #945 burn presenter on the shared scheduler. It decides nothing: the `terminalFieldBurn`
 * scene trait says when, and what the gate releases.
 *
 * - **Captured once.** The ghosts are built from the cards on the table when the burn starts, at
 *   their poses relative to the board, so they keep following the board while the result shows.
 *   Only the table's cards are captured: the hand, deck, rack, stock and menus are other services.
 * - **Cosmetic order.** The presenter's shuffle draws from the cosmetic random source, never the
 *   session's.
 * - **Run-scoped.** `reset` (a new run, the main menu, a restart: the table being reset) cancels
 *   the outgoing root and frees every ghost before the next board shows, so nothing stale flashes.
 *   Ordinary cover by the result screen leaves it running.
 */
import * as THREE from "three";
import type { RenderedBlock } from "./rendered-blocks";
import type { TerminalBurnRendererService } from "./visual/terminal-burn-renderer";
import {
  defaultTerminalBurn,
  startTerminalFieldBurn,
  type TerminalBurn,
  type TerminalBurnConfig,
} from "./visual/terminal-field-burn";
import type { ScopeStatus, VisualScheduler } from "./visual-events/scheduler";

export type TerminalBurnServiceOptions = {
  scheduler: VisualScheduler;
  renderer: TerminalBurnRendererService;
  /** The board the cards stand on: ghosts follow it. */
  board: THREE.Object3D;
  /** The table's own views, captured and hidden when the burn starts. */
  field: { blocks(): readonly RenderedBlock[] };
  random: () => number;
  reducedMotion: () => boolean;
};

export type TerminalBurnHandle = {
  /** Called once with the result gate's settled status. */
  onGate(listener: (status: ScopeStatus) => void): () => void;
};

export function createTerminalBurnService(options: TerminalBurnServiceOptions) {
  let running: TerminalBurn | null = null;
  const toBoard = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const service = {
    /** Burn the table's cards now; the handle reports the result gate. */
    start(config?: Partial<TerminalBurnConfig>): TerminalBurnHandle {
      service.reset();
      const { board } = options;
      board.updateWorldMatrix(true, true);
      toBoard.copy(board.matrixWorld).invert();
      const shown = options.field.blocks();
      const cards = shown.map(({ block, cube }) => {
        local.multiplyMatrices(toBoard, cube.matrixWorld).decompose(position, quaternion, scale);
        return {
          block,
          position: position.toArray() as THREE.Vector3Tuple,
          quaternion: quaternion.toArray() as THREE.Vector4Tuple,
          scale: scale.toArray() as THREE.Vector3Tuple,
        };
      });
      const ghostIds = options.renderer.capture(board, cards);
      // The ghosts stand in for the table's own views from now on.
      for (const { cube } of shown) cube.visible = false;
      running = startTerminalFieldBurn(options.scheduler, {
        ghostIds,
        random: options.random,
        reducedMotion: options.reducedMotion(),
        renderer: options.renderer,
        config: { ...defaultTerminalBurn, ...config },
      });
      return { onGate: (listener) => running?.onGate(listener) ?? (() => {}) };
    },
    /** Cancel any burn and free its ghosts (the table is being reset). */
    reset(): void {
      running?.cancel();
      running = null;
      options.renderer.dispose();
    },
  };
  return service;
}

export type TerminalBurnService = ReturnType<typeof createTerminalBurnService>;
