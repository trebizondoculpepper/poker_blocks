/**
 * The first-play prompt (#203): the ghost cube that invites a stage's first play. Everything it
 * does lives here, configured by the scene's `firstPlayPrompt` data:
 *
 * - **Idle:** while the field is empty and a play can be made, the ghost pulses in the first
 *   play's cell.
 * - **Armed:** while a dragged block is over that cell, it brightens and breathes larger and
 *   quicker, so the drop target clearly responds.
 * - **Release:** when the first block is played, an outline grows and fades from that cell
 *   instead of the ghost simply vanishing.
 *
 * Reduced motion keeps each response but without movement. The trait owns its meshes; it only
 * asks the table where the first play would go, what is being dragged, and where to put a model.
 * A scene that doesn't compose it shows no prompt (the title, say).
 */
import * as THREE from "three";
import type { SceneTraitBehaviour } from "../scenes";
import { beatShapes } from "../dance/beat-shapes";
import type { DanceFloor } from "../dance/dance-floor";
import type { Cell } from "../traits/attachable";

export type FirstPlayPromptConfig = {
  /** The ghost's colour (hex). */
  colour: number;
  /** The idle pulse's period, in seconds. */
  pulseSeconds: number;
  /** While a dragged block is over the cell. */
  armed: {
    /** The breathing period, in seconds. */
    beatSeconds: number;
    /** The ghost's scale at the bottom and the top of a breath. */
    scale: readonly [number, number];
    /** The fill's opacity at the bottom and the top of a breath. */
    opacity: readonly [number, number];
  };
  /**
   * Dance with the music (#256): while music plays, the idle pulse follows this cycle instead of
   * its own period, shaped by a registered beat shape. Leave it out and the ghost never dances.
   */
  dance?: {
    /** A registered dance cycle: `halfBeat`, `beat`, `bar`, `twoBars`. */
    cycle: string;
    /** A registered beat shape: `sine`, `pulse`, `bounce`, `gate`. */
    shape: string;
    /** Beats to shift the move by (negative peaks a little early, which reads as on time). */
    offset: number;
    /** How much larger the ghost grows at the top of the move, as a fraction of a cell. */
    swell: number;
  };
  /** When the first block is played. */
  release: {
    seconds: number;
    /** How much larger the outline grows by the end, as a fraction of a cell. */
    growth: number;
  };
};

/** What the trait needs from the table, the run and the input. */
export type FirstPlayTable = {
  /** The first play's cell while the field is empty and a play can be made; otherwise null. */
  firstPlayCell(): Cell | null;
  fieldCount(): number;
  /** The cell a dragged block would be played into right now, if any. */
  candidateCell(): Cell | null;
  /** A block or the board is being dragged, or a play is animating. */
  busy(): boolean;
  reducedMotion(): boolean;
  /** Put a model at a cell of the structure, so it moves with the blocks; or take it away. */
  placeObject(object: THREE.Object3D, cell: Cell): void;
  removeObject(object: THREE.Object3D): void;
  readonly cubeSize: number;
  /** The dance floor, for a prompt that dances with the music. */
  danceFloor: Pick<DanceFloor, "join">;
};

/** One ghost model: a translucent box and its outline, with materials of its own. */
type Ghost = {
  mesh: THREE.Mesh;
  fill: THREE.MeshBasicMaterial;
  edges: THREE.LineBasicMaterial;
  dispose(): void;
};

function createGhost(size: number, colour: number): Ghost {
  const geometry = new THREE.BoxGeometry(size, size, size);
  const edgeGeometry = new THREE.EdgesGeometry(geometry);
  const fill = new THREE.MeshBasicMaterial({ color: colour, transparent: true, depthWrite: false });
  const edges = new THREE.LineBasicMaterial({ color: colour, transparent: true });
  const mesh = new THREE.Mesh(geometry, fill);
  mesh.add(new THREE.LineSegments(edgeGeometry, edges));
  mesh.renderOrder = 11;
  return {
    mesh,
    fill,
    edges,
    dispose() {
      geometry.dispose();
      edgeGeometry.dispose();
      fill.dispose();
      edges.dispose();
    },
  };
}

const sameCell = (a: Cell | null, b: Cell | null) =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;

/** One scene's prompt state, from entering the scene until it leaves. */
type PromptState = {
  ghost: Ghost;
  /** Where the ghost is now, or null while hidden. */
  cell: Cell | null;
  /** The last cell the prompt was shown in, for the release burst. */
  lastCell: Cell | null;
  fieldCount: number;
  time: number;
  burst: { ghost: Ghost; elapsed: number } | null;
  /** The ghost's dance (#256): the shaped move and the music's energy, from the dance floor. */
  move: { level: number; energy: number };
  leaveFloor: (() => void) | null;
};

export function firstPlayPrompt<
  Context extends { services: { firstPlay: FirstPlayTable } },
>(): SceneTraitBehaviour<Context, FirstPlayPromptConfig> {
  // Each scene composing the trait gets its own prompt; keyed by the config object it composed.
  const states = new WeakMap<FirstPlayPromptConfig, PromptState>();

  function hide(table: FirstPlayTable, state: PromptState): void {
    if (state.cell) table.removeObject(state.ghost.mesh);
    state.cell = null;
  }

  function endBurst(table: FirstPlayTable, state: PromptState): void {
    if (!state.burst) return;
    table.removeObject(state.burst.ghost.mesh);
    state.burst.ghost.dispose();
    state.burst = null;
  }

  return {
    enter({ services: { firstPlay } }, config) {
      const state: PromptState = {
        ghost: createGhost(firstPlay.cubeSize, config.colour),
        cell: null,
        lastCell: null,
        fieldCount: firstPlay.fieldCount(),
        time: 0,
        burst: null,
        move: { level: 0, energy: 0 },
        leaveFloor: null,
      };
      states.set(config, state);
      // The ghost dances by joining the floor: it follows its cycle, and its dance records the
      // shaped move, which the idle pulse below blends towards as the music's energy rises.
      const { dance } = config;
      if (dance) {
        const shape = beatShapes.get(dance.shape);
        state.leaveFloor = firstPlay.danceFloor.join({
          cycle: dance.cycle,
          offset: dance.offset,
          dance: ({ phase, energy }) => {
            state.move = { level: shape(phase), energy };
          },
        });
      }
    },
    exit({ services: { firstPlay } }, config) {
      const state = states.get(config);
      if (!state) return;
      hide(firstPlay, state);
      endBurst(firstPlay, state);
      state.leaveFloor?.();
      state.ghost.dispose();
      states.delete(config);
    },
    update({ services: { firstPlay } }, config, dt) {
      const state = states.get(config);
      if (!state) return;
      state.time += dt;
      const still = firstPlay.reducedMotion();

      // Release: the field has just gained its first block where the prompt was.
      const count = firstPlay.fieldCount();
      if (state.fieldCount === 0 && count > 0 && state.lastCell) {
        endBurst(firstPlay, state);
        const ghost = createGhost(firstPlay.cubeSize, config.colour);
        firstPlay.placeObject(ghost.mesh, state.lastCell);
        state.burst = { ghost, elapsed: 0 };
        state.lastCell = null;
      }
      state.fieldCount = count;
      if (state.burst) {
        state.burst.elapsed += dt;
        const progress = Math.min(1, state.burst.elapsed / config.release.seconds);
        const eased = 1 - (1 - progress) ** 3;
        state.burst.ghost.mesh.scale.setScalar(still ? 1 : 1 + config.release.growth * eased);
        state.burst.ghost.fill.opacity = config.armed.opacity[1] * (1 - progress);
        state.burst.ghost.edges.opacity = 1 - progress;
        if (progress >= 1) endBurst(firstPlay, state);
      }

      // Idle or armed: shown in the first play's cell, unless something else is going on.
      const cell = firstPlay.firstPlayCell();
      const armed = sameCell(cell, firstPlay.candidateCell());
      const show = cell && (armed || !firstPlay.busy()) ? cell : null;
      if (!show) return hide(firstPlay, state);
      if (!sameCell(show, state.cell)) {
        hide(firstPlay, state);
        firstPlay.placeObject(state.ghost.mesh, show);
        state.cell = show;
      }
      state.lastCell = show;
      const { ghost } = state;
      if (armed) {
        const beat = (1 + Math.sin((state.time * Math.PI * 2) / config.armed.beatSeconds)) / 2;
        const [low, high] = config.armed.scale;
        const [dim, bright] = config.armed.opacity;
        ghost.mesh.scale.setScalar(still ? 1 : low + (high - low) * beat);
        ghost.fill.opacity = dim + (bright - dim) * beat;
        ghost.edges.opacity = 1;
        return;
      }
      // Idle: its own slow pulse, blending onto the music's beat as the dance's energy rises.
      const idle = still
        ? 0.8
        : (1 + Math.cos((state.time * Math.PI * 2) / config.pulseSeconds)) / 2;
      const { level, energy } = state.move;
      const pulse = idle + (level - idle) * energy;
      ghost.mesh.scale.setScalar(1 + (config.dance?.swell ?? 0) * level * energy);
      ghost.fill.opacity = 0.18 * pulse;
      ghost.edges.opacity = pulse;
    },
  };
}
