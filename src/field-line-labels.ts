/**
 * Fitted line-score narration over the scored line (#1158; doc/presentation-contracts.md, "Shared
 * fitted narration text and over-item activation labels", "Committed descriptor and timing
 * ownership"). Line scores use the same fitted layout, style and over-bounds placement as passive
 * activation labels (#1157); there is no score-specific fitting engine.
 *
 * - **Anchor.** The `fieldLine` anchor space resolves a captured line (its block ids) to the
 *   projected bounds of those blocks' rendered cubes, live, in the label layer's CSS pixels. It
 *   reads presentation transforms only, never the model; a line whose blocks are all gone ends.
 * - **Text.** Captured points only, so the wording is honest and generic: "Line" and the points.
 *   No poker-hand name is invented.
 * - **Timing.** One `activationLabel` alongside event per line, at the line's existing narration
 *   time, lasting the line's tint settle. No new timer, sound or result gate; the layer's one
 *   live region announces it once.
 */
import * as THREE from "three";
import type { ActivationLabelPayload, AnchorPoint } from "./visual/activation-labels";
import { labelAnchorSpaces } from "./visual/activation-labels";
import type { AlongsideEvent, NarratedLine } from "./score-narration";

/** The field's line anchors, as a visual-event service. */
export type FieldLineAnchors = {
  anchorOf(blockIds: readonly string[]): () => AnchorPoint | null;
};
export type FieldLineServices = { fieldLines?: FieldLineAnchors };

labelAnchorSpaces.register("fieldLine", (anchor, services) => {
  const lines = (services as FieldLineServices | undefined)?.fieldLines;
  return lines && Array.isArray(anchor) ? lines.anchorOf(anchor.map(String)) : () => null;
});

const box = new THREE.Box3();
const part = new THREE.Box3();
const corner = new THREE.Vector3();

/**
 * Field line anchors from presentation: the rendered cubes by block id, the board camera, and the
 * canvas it draws into, measured against the label layer's host.
 */
export function createFieldLineAnchors(options: {
  cubes(): readonly { id: string; object: THREE.Object3D }[];
  camera(): THREE.Camera;
  canvas: {
    getBoundingClientRect(): DOMRect | { left: number; top: number; width: number; height: number };
  };
  host: { getBoundingClientRect(): DOMRect | { left: number; top: number } };
}): FieldLineAnchors {
  return {
    anchorOf(blockIds) {
      const wanted = new Set(blockIds);
      return () => {
        const objects = options.cubes().filter(({ id }) => wanted.has(id));
        if (objects.length === 0) return null;
        box.makeEmpty();
        for (const { object } of objects) {
          object.updateWorldMatrix(true, true);
          box.union(part.setFromObject(object));
        }
        if (box.isEmpty()) return null;
        const camera = options.camera();
        camera.updateMatrixWorld();
        const canvas = options.canvas.getBoundingClientRect();
        const origin = options.host.getBoundingClientRect();
        let left = Infinity;
        let right = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;
        for (let i = 0; i < 8; i++) {
          corner
            .set(
              i & 1 ? box.max.x : box.min.x,
              i & 2 ? box.max.y : box.min.y,
              i & 4 ? box.max.z : box.min.z,
            )
            .project(camera);
          const x = canvas.left - origin.left + ((corner.x + 1) / 2) * canvas.width;
          const y = canvas.top - origin.top + ((1 - corner.y) / 2) * canvas.height;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
        const bounds = { x: left, y: top, width: right - left, height: bottom - top };
        return { x: left + bounds.width / 2, y: top, bounds };
      };
    },
  };
}

/** Honest generic wording for a line known only by its points. */
export function lineScoreText(points: number): string {
  return `Line\n${points >= 0 ? "+" : ""}${points}`;
}

/** A captured line's fitted score label, over the line, for `durationUnits`. */
export function lineScoreLabel(
  line: Pick<NarratedLine, "blockIds" | "points">,
  durationUnits: number,
): AlongsideEvent {
  const payload: ActivationLabelPayload = {
    text: lineScoreText(line.points),
    space: "fieldLine",
    anchor: [...line.blockIds],
    durationUnits,
    placement: "overBounds",
  };
  return { handler: "activationLabel", payload };
}
