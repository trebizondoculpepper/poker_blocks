/**
 * A shell-free full volume (#1230; doc/optical-interiors.md, "Full-volume and pooled-bubble
 * composition"): contents that fill the whole interior of a block whose own look draws its faces
 * (Calm Water's optical front), with no plastic shell and nothing drawn of their own. They publish
 * the same capabilities a contained fluid does, so inclusions such as rising bubbles compose
 * against either without asking which:
 *
 * - `liquidSurface`: everything inside is wet. Its top is the level plane touching the volume's
 *   highest point in the world, whose block-local normal is world up's covector (`worldUpInBlock`).
 * - `volume`: the interior's block-local bounds and the block-local direction that rises straight
 *   up in the world, which differs from that normal under nonuniform scale.
 *
 * Updated from the block's one frame (`ContainedFrame.toWorld`), before any inclusion. A transform
 * that can't be inverted keeps the previous directions and says so once, never claiming world up.
 */
import * as THREE from "three";
import {
  containedContents,
  worldUpInBlock,
  type ContentsHandler,
  type LiquidSurface,
} from "./contained";

/** Where a full volume reports a transform it can't follow (default: the console's warning). */
let diagnose: (message: string) => void = (message) => console.warn(message);

/** Replace the diagnostic sink; returns how to put back the previous one (for tests and tools). */
export function setFullVolumeDiagnostics(next: (message: string) => void): () => void {
  const previous = diagnose;
  diagnose = next;
  return () => {
    diagnose = previous;
  };
}

export const fullVolume: ContentsHandler = (boundary) => {
  const extent = boundary.halfSize * boundary.volumeScale;
  const bounds = new THREE.Box3(
    new THREE.Vector3(-extent, -extent, -extent),
    new THREE.Vector3(extent, extent, extent),
  );
  const normal = new THREE.Vector3(0, 1, 0);
  const rise = new THREE.Vector3(0, 1, 0);
  let height = extent;
  let reported = false;
  const surface: LiquidSurface = {
    normal,
    get height() {
      return height;
    },
    wet: (point) => bounds.containsPoint(point) && point.dot(normal) <= height,
  };
  return {
    meshes: [],
    update({ toWorld }) {
      if (!worldUpInBlock(toWorld, normal, rise)) {
        if (!reported)
          diagnose("full volume: its block's transform can't be inverted; world up is unknown");
        reported = true;
        return;
      }
      // The cube's support along the normal: its highest point in the world lies on this plane.
      height = extent * (Math.abs(normal.x) + Math.abs(normal.y) + Math.abs(normal.z));
    },
    capabilities: { liquidSurface: surface, volume: { bounds, rise, surface } },
  };
};

containedContents.register("fullVolume", fullVolume);
