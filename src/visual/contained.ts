/**
 * Contained components (#330; contracts in doc/game-architecture.md, "Contained components",
 * #329). A contained block is a **shell** (what you see), an **interior boundary** (where
 * contents live) and optional **contents**, each named by a material's appearance data and
 * built by a handler registered here. Nothing here asks which shell or contents it holds.
 *
 * This slice extracts custard's plastic shell and keeps its fluid and wall trace as one
 * contents handler; separating fluid, look and residue is #332–#334.
 */
import * as THREE from "three";
import { Registry } from "../core/registry";

/** Render order inside a contained block (#329): parts ask for a layer, never a number. */
export const containedLayers = {
  shellBack: 1,
  contentsOpaque: 2,
  residue: 3,
  contentsTransparent: 4,
  shellFront: 5,
  gloss: 6,
} as const;
export type ContainedLayer = keyof typeof containedLayers;

/**
 * Where contents live: the block's own geometry, scaled to the inside of the wall. Coordinates
 * are block-local and unscaled; the meshes it makes carry the scale.
 */
export type InteriorBoundary = {
  readonly geometry: THREE.BufferGeometry;
  /** Scale from the block's outer surface to the inside of its wall (0–1). */
  readonly inset: number;
  /** Half the block's size, in block-local units. */
  readonly halfSize: number;
  /** A mesh lying just inside the wall, for wall effects (a trace, a film). */
  wall(material: THREE.Material, layer: ContainedLayer): THREE.Mesh;
  /** A mesh filling the interior, for contents (a fluid, a flame). */
  volume(material: THREE.Material, layer: ContainedLayer): THREE.Mesh;
};

/** How far inside the wall's inner face wall effects and contents sit (from custard, #227). */
const wallGap = 0.995;
const volumeGap = 0.97;

export function createInteriorBoundary(
  geometry: THREE.BufferGeometry,
  size: number,
  inset: number,
): InteriorBoundary {
  const place = (material: THREE.Material, layer: ContainedLayer, scale: number) => {
    const made = new THREE.Mesh(geometry, material);
    made.scale.setScalar(scale);
    made.renderOrder = containedLayers[layer];
    return made;
  };
  return {
    geometry,
    inset,
    halfSize: size / 2,
    wall: (material, layer) => place(material, layer, inset * wallGap),
    volume: (material, layer) => place(material, layer, inset * volumeGap),
  };
}

/** What a shell gives the block: its outer face materials, extra meshes and its interior. */
export type ContainerShell = {
  /** The material on the block's six outer faces, or one per face (BoxGeometry order). */
  faces: THREE.Material | readonly THREE.Material[];
  /** Its other meshes (an inner wall, a gloss layer), placed in their layers. */
  meshes: THREE.Mesh[];
  /** Scale from the outer surface to the inside of its wall: where its interior starts. */
  inset: number;
};

export type ShellContext = {
  geometry: THREE.BufferGeometry;
  environment: THREE.Texture | null;
  /**
   * The material's own face artwork (its configured pattern, without the print), made once
   * per block, for a shell drawn from it (a frame, leaded panes). The block disposes it.
   */
  faceTexture: () => THREE.CanvasTexture;
  /** The material's own configured surface over a texture (an iron frame's metal). */
  ownSurface: (texture: THREE.CanvasTexture) => THREE.Material;
};

export type ShellHandler = (context: ShellContext, config: unknown) => ContainerShell;

/**
 * A liquid's top, published by contents that have one (#332), in the boundary's block-local,
 * unscaled space: a point p is inside the liquid where dot(p, normal) <= height. It is live:
 * the contents update it each frame, before any consumer draws.
 */
export type LiquidSurface = {
  readonly normal: THREE.Vector3;
  readonly height: number;
  wet(point: THREE.Vector3): boolean;
};

/** What contents publish for others to read (#329): only what they genuinely have. */
export type Capabilities = { liquidSurface?: LiquidSurface };

/**
 * One frame of a contained block (#329 "Lifecycle and ownership"), built once per block per
 * frame by `composeContained` and handed to its parts in order: contents, then residue. No part
 * reads the clock or the block's rotation itself.
 */
export type ContainedFrame = {
  /** Seconds since the block's first frame (frame time, the same for every part). */
  readonly seconds: number;
  /** Seconds since its previous frame, capped; 0 on the first frame. */
  readonly delta: number;
  /** True on the block's first frame: parts start from their resting state. */
  readonly first: boolean;
  /** The block's world rotation this frame. */
  readonly rotation: THREE.Quaternion;
};

/** What contents add inside a boundary: their meshes, what they publish, their frame update. */
export type ContentsHandler = (
  boundary: InteriorBoundary,
  config: unknown,
) => { meshes: THREE.Mesh[]; capabilities: Capabilities; update?: (frame: ContainedFrame) => void };

/**
 * Optional residue on the wall (#332, #334): it samples what the contents publish and keeps its
 * own history; the contents never know it exists. It names the capability it needs, so a
 * composition that cannot supply it fails when the material is built.
 */
export type ResidueHandler = {
  requires: keyof Capabilities;
  build(
    boundary: InteriorBoundary,
    capabilities: Capabilities,
    config: unknown,
  ): { meshes: THREE.Mesh[]; update?: (frame: ContainedFrame) => void };
};

export const containerShells = new Registry<ShellHandler>("container shell");
export const containedContents = new Registry<ContentsHandler>("contained contents");
export const containedResidues = new Registry<ResidueHandler>("contained residue");

/** A material's container data: a registered shell and its configuration. */
export type ContainerConfig = { shell: string; config: unknown };
/** A material's contents data: a registered contents handler and its configuration. */
export type ContentsConfig = { effect: string; config: unknown };
/** A material's residue data: a registered residue handler and its configuration. */
export type ResidueConfig = { effect: string; config: unknown };

/**
 * Build a contained block: the shell, then its interior boundary, then the contents (if any)
 * inside it. Each part's meshes carry their own materials, which the block disposes.
 */
export function composeContained(
  context: ShellContext & { size: number },
  container: ContainerConfig,
  contents: ContentsConfig | undefined,
  residue?: ResidueConfig,
): { faces: readonly THREE.Material[]; extras: THREE.Mesh[] } {
  const shell = containerShells.get(container.shell)(context, container.config);
  const boundary = createInteriorBoundary(context.geometry, context.size, shell.inset);
  // No contents is an empty container: the same composition with nothing inside.
  const inside = [contents ?? []]
    .flat()
    .map(({ effect, config }) => containedContents.get(effect)(boundary, config));
  const capabilities: Capabilities = Object.assign({}, ...inside.map((part) => part.capabilities));
  // Residue reads what the contents publish; it never reaches into them.
  const wall = [residue ?? []].flat().map(({ effect, config }) => {
    const handler = containedResidues.get(effect);
    if (!capabilities[handler.requires])
      throw new Error(`Residue "${effect}" needs contents that publish ${handler.requires}`);
    return handler.build(boundary, capabilities, config);
  });
  const parts = [...inside, ...wall];
  const meshes = parts.flatMap((part) => part.meshes);
  // One frame per block: contents update before residue, from one clock and one rotation.
  // Three.js draws opaque and transparent meshes in separate queues whatever their render
  // order, so the tick is on every contained mesh: whichever draws first in a frame runs it,
  // before any part draws, and the rest of that frame it does nothing.
  const updates = parts.flatMap((part) => [part.update ?? []].flat());
  const rotation = new THREE.Quaternion();
  let start: number | null = null;
  let last: number | null = null;
  const tick = (mesh: THREE.Mesh) => {
    const now = frameSeconds();
    if (now === last) return;
    start ??= now;
    const frame: ContainedFrame = {
      seconds: now - start,
      delta: last === null ? 0 : Math.min(now - last, 0.1),
      first: last === null,
      rotation: mesh.getWorldQuaternion(rotation),
    };
    last = now;
    for (const update of updates) update(frame);
  };
  for (const mesh of [...shell.meshes, ...meshes]) {
    const previous = mesh.onBeforeRender.bind(mesh);
    mesh.onBeforeRender = (...args) => {
      tick(mesh);
      previous(...args);
    };
  }
  const faces = [shell.faces].flat();
  return {
    faces: Array.from({ length: 6 }, (_, face) => faces[face % faces.length]!),
    extras: [...shell.meshes, ...meshes],
  };
}

/** The current frame's time, in seconds: the same for every block drawn in one frame. */
function frameSeconds(): number {
  const time = typeof document === "undefined" ? null : document.timeline?.currentTime;
  return (typeof time === "number" ? time : performance.now()) / 1000;
}
