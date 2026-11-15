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
import { appearanceSeconds } from "./appearance-clock";

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
  /** The scale `volume` meshes carry: their local units times this are block-local. */
  readonly volumeScale: number;
  /** The scale `wall` meshes carry. */
  readonly wallScale: number;
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
    volumeScale: inset * volumeGap,
    wallScale: inset * wallGap,
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

/**
 * How particles suspended in a contents' volume are drawn so they show through it (#742;
 * doc/presentation-contracts.md, "Material audition corrections"): the optical contents own this
 * integration. A transmissive fluid only shows what three.js captures behind it, which is the
 * opaque scene, so it asks its particles to join that capture. Contents with no such need
 * publish none, and particles keep their own look.
 */
export type InteriorContribution = { include(particles: THREE.Points): void };

/**
 * The volume particles may occupy and the way a buoyant one moves (#1230; doc/optical-interiors.md,
 * "Full-volume and pooled-bubble composition"), in the boundary's block-local, unscaled space and
 * live like `LiquidSurface`. `rise` is world up carried back by the inverse of the block's
 * transform: under nonuniform scale it is not the surface's normal, which is world up's covector.
 */
export type InteriorVolume = {
  readonly bounds: THREE.Box3;
  readonly rise: THREE.Vector3;
  readonly surface: LiquidSurface;
};

/** What contents publish for others to read (#329): only what they genuinely have. */
export type Capabilities = {
  liquidSurface?: LiquidSurface;
  interior?: InteriorContribution;
  volume?: InteriorVolume;
};

const linear = new THREE.Matrix3();
const turned = new THREE.Matrix3();

/**
 * World up in a block's own space, given its block-local-to-world transform (#1230): `normal`,
 * the local normal of a level plane (the transpose carries the covector), and `rise`, the local
 * direction that moves straight up in the world (the inverse carries the vector). Both unit.
 * A transform that can't be inverted (a zero scale) changes neither and answers false, so a
 * provider says so rather than claiming a direction it doesn't have.
 */
export function worldUpInBlock(
  toWorld: THREE.Matrix4,
  normal: THREE.Vector3,
  rise: THREE.Vector3,
): boolean {
  linear.setFromMatrix4(toWorld);
  if (!(Math.abs(linear.determinant()) > 1e-12)) return false;
  normal.set(0, 1, 0).applyMatrix3(turned.copy(linear).transpose()).normalize();
  rise.set(0, 1, 0).applyMatrix3(turned.copy(linear).invert()).normalize();
  return true;
}

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
  /** The block's own (block-local, unscaled) to world transform this frame (#1230). */
  readonly toWorld: THREE.Matrix4;
  /** The player's reduced-motion setting: drifting parts hold still or calm down (#349). */
  readonly reducedMotion: boolean;
};

let reducedMotion: () => boolean = () => false;

/**
 * Where contained parts read the player's reduced-motion setting; the game wires it (main). Returns
 * how to put back the previous provider, so a host that runs its own explicit configuration (the
 * profiler, #974) never leaves the player's setting replaced.
 */
export function setContainedReducedMotion(provider: () => boolean): () => void {
  const previous = reducedMotion;
  reducedMotion = provider;
  return () => {
    reducedMotion = previous;
  };
}

/** A contained part: a mesh, or points (a field of particles, #349). */
export type ContainedPart = THREE.Mesh | THREE.Points;

/** What contents add inside a boundary: their meshes, what they publish, their frame update. */
export type ContentsHandler = (
  boundary: InteriorBoundary,
  config: unknown,
) => {
  meshes: ContainedPart[];
  capabilities: Capabilities;
  update?: (frame: ContainedFrame) => void;
};

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
  ): { meshes: ContainedPart[]; update?: (frame: ContainedFrame) => void };
};

/**
 * Optional inclusions inside the contents (#353): something suspended in them, such as bubbles,
 * that reads what the contents publish exactly as residue does, but lives in the volume rather
 * than on the wall. Removing one changes nothing else.
 */
export type InclusionHandler = ResidueHandler;

export const containerShells = new Registry<ShellHandler>("container shell");
export const containedContents = new Registry<ContentsHandler>("contained contents");
export const containedResidues = new Registry<ResidueHandler>("contained residue");
export const containedInclusions = new Registry<InclusionHandler>("contained inclusion");

/** A material's container data: a registered shell and its configuration. */
export type ContainerConfig = { shell: string; config: unknown };
/** A material's contents data: a registered contents handler and its configuration. */
export type ContentsConfig = { effect: string; config: unknown };
/** A material's residue data: a registered residue handler and its configuration. */
export type ResidueConfig = { effect: string; config: unknown };
/** A material's inclusions data: registered inclusion handlers and their configuration. */
export type InclusionConfig = { effect: string; config: unknown };

/**
 * Build a contained block: the shell, then its interior boundary, then the contents (if any)
 * inside it. Each part's meshes carry their own materials, which the block disposes.
 */
export function composeContained(
  context: ShellContext & { size: number },
  container: ContainerConfig,
  contents: ContentsConfig | undefined,
  residue?: ResidueConfig,
  inclusions: readonly InclusionConfig[] = [],
): { faces: readonly THREE.Material[]; extras: ContainedPart[] } {
  const shell = containerShells.get(container.shell)(context, container.config);
  const boundary = createInteriorBoundary(context.geometry, context.size, shell.inset);
  const meshes = composeInterior(boundary, { contents, residue, inclusions }, shell.meshes);
  const faces = [shell.faces].flat();
  return {
    faces: Array.from({ length: 6 }, (_, face) => faces[face % faces.length]!),
    extras: [...shell.meshes, ...meshes],
  };
}

/** What a material's appearance puts inside a boundary: contents, residue and inclusions. */
export type InteriorConfig = {
  contents?: ContentsConfig | undefined;
  residue?: ResidueConfig | undefined;
  inclusions?: readonly InclusionConfig[] | undefined;
};

/**
 * A shell-free interior (#1230; doc/optical-interiors.md, "Full-volume and pooled-bubble
 * composition"): the same contents, residue and inclusions in the block's whole volume, with no
 * container shell. The look that owns the block's faces (an optical front) keeps them; these are
 * its extras, which the block disposes.
 */
export function composeShellFree(
  context: { geometry: THREE.BufferGeometry; size: number },
  interior: InteriorConfig,
): ContainedPart[] {
  return composeInterior(createInteriorBoundary(context.geometry, context.size, 1), interior, []);
}

/**
 * Build what lies inside a boundary and run its one frame (#329): contents, then inclusions, then
 * residue, ticked by whichever of their meshes (or `ticking`, a shell's) draws first.
 */
function composeInterior(
  boundary: InteriorBoundary,
  { contents, residue, inclusions = [] }: InteriorConfig,
  ticking: readonly ContainedPart[],
): ContainedPart[] {
  // No contents is an empty container: the same composition with nothing inside.
  const inside = [contents ?? []]
    .flat()
    .map(({ effect, config }) => containedContents.get(effect)(boundary, config));
  const capabilities: Capabilities = Object.assign({}, ...inside.map((part) => part.capabilities));
  // Residue and inclusions read what the contents publish; they never reach into them.
  const dependent =
    (registry: Registry<ResidueHandler>, kind: string) =>
    ({ effect, config }: { effect: string; config: unknown }) => {
      const handler = registry.get(effect);
      if (!capabilities[handler.requires])
        throw new Error(`${kind} "${effect}" needs contents that publish ${handler.requires}`);
      return handler.build(boundary, capabilities, config);
    };
  const wall = [residue ?? []].flat().map(dependent(containedResidues, "Residue"));
  const suspended = inclusions.map(dependent(containedInclusions, "Inclusion"));
  const parts = [...inside, ...suspended, ...wall];
  const meshes = parts.flatMap((part) => part.meshes);
  // One frame per block: contents update before residue, from one clock and one rotation.
  // Three.js draws opaque and transparent meshes in separate queues whatever their render
  // order, so the tick is on every contained mesh: whichever draws first in a frame runs it,
  // before any part draws, and the rest of that frame it does nothing.
  const updates = parts.flatMap((part) => [part.update ?? []].flat());
  const rotation = new THREE.Quaternion();
  const toWorld = new THREE.Matrix4();
  let start: number | null = null;
  let last: number | null = null;
  const tick = (mesh: ContainedPart) => {
    const now = appearanceSeconds();
    if (now === last) return;
    start ??= now;
    const frame: ContainedFrame = {
      seconds: now - start,
      delta: last === null ? 0 : Math.min(now - last, 0.1),
      first: last === null,
      rotation: mesh.getWorldQuaternion(rotation),
      // The block's transform: the part's world transform without the part's own (its scale).
      toWorld: toWorld.copy(mesh.matrix).invert().premultiply(mesh.matrixWorld),
      reducedMotion: reducedMotion(),
    };
    last = now;
    for (const update of updates) update(frame);
  };
  for (const mesh of [...ticking, ...meshes]) {
    const previous = mesh.onBeforeRender.bind(mesh);
    mesh.onBeforeRender = (...args) => {
      tick(mesh);
      previous(...args);
    };
  }
  // The contents' own meshes say so, so an exit can tell them from the shell's inner layers and
  // gloss, which are extras too (#672 review): the shell breaks, the contents fade.
  for (const mesh of meshes) mesh.userData.containedContents = true;
  return meshes;
}

/**
 * A built contained block's own split (#672, #1024): the children its composition marked as
 * contents, and the rest (the shell's inner layers and gloss, the print skin). The block's faces
 * are its own materials.
 */
export function containedParts(block: THREE.Mesh): {
  shell: THREE.Object3D[];
  contents: THREE.Object3D[];
} {
  return {
    shell: block.children.filter((child) => !child.userData.containedContents),
    contents: block.children.filter((child) => child.userData.containedContents),
  };
}

/**
 * Show or hide a contained block's container and its contents independently (#1024, doc/
 * audition-followups.md, "Flame Bench"): the faces through the block's own materials, so hiding
 * the container never hides the contents. The materials belong to this block alone.
 */
export function setContainedVisibility(
  block: THREE.Mesh,
  visible: { container: boolean; contents: boolean },
): void {
  const { shell, contents } = containedParts(block);
  const faces = ([] as THREE.Material[]).concat(block.material);
  for (const face of faces) face.visible = visible.container;
  for (const part of shell) part.visible = visible.container;
  for (const part of contents) part.visible = visible.contents;
}
