/**
 * The comparison room's view gestures (#524, #637 review), as plain handlers over a small view
 * state so their whole lifecycle can be tested without a browser:
 *
 * - **Drag** turns the collection, but never while a pinch is active (the first finger of a pinch
 *   is still a drag to use-gesture).
 * - **Wheel** zooms by the table's exponential step, and ignores the synthetic callback
 *   use-gesture sends when a wheel gesture ends, which repeats the last native event.
 * - **Pinch** zooms by the ratio of finger spacing to where it started, and a two-finger twist
 *   turns the collection.
 *
 * Wheel and pinch play the game's zoom sound once, as each gesture begins; a turning drag plays
 * the view-turn sound once as it begins.
 */
import * as THREE from "three";
import { wheelZoom } from "../../view-zoom";

export type ViewState = { distance: number; turnX: number; turnY: number };

export const minDistance = 2;
export const maxDistance = 80;

const clamp = (value: number) => Math.min(maxDistance, Math.max(minDistance, value));

/** Camera distance after a wheel step: the table's exponential zoom, applied to distance. */
export function wheelDistance(distance: number, deltaY: number, deltaMode: number) {
  return distance / wheelZoom(1, deltaY, deltaMode);
}

/** Camera distance for a pinch: the start distance scaled by start spacing over spacing now. */
export function pinchDistance(startDistance: number, startSpacing: number, spacing: number) {
  return (startDistance * startSpacing) / Math.max(1, spacing);
}

/** How far a two-finger twist turns the collection: the angle change since last event. */
export function twistTurn(previousDegrees: number, degrees: number): number {
  return THREE.MathUtils.degToRad(degrees - previousDegrees);
}

type PinchMemo = { distance: number; spacing: number; angle: number };

export function viewControls(
  view: ViewState,
  zoomSound: () => void,
  rotateSound: () => void = () => {},
) {
  let pinching = false;
  return {
    onDrag({ first, delta: [dx, dy] }: { first?: boolean; delta: [number, number] }) {
      if (pinching) return;
      if (first) rotateSound();
      view.turnY += dx * 0.01;
      view.turnX += dy * 0.01;
    },
    onWheel({
      first,
      last,
      event,
    }: {
      first: boolean;
      last: boolean;
      event: { deltaY: number; deltaMode: number };
    }) {
      if (first) zoomSound();
      // The end callback carries the previous native event again, not new movement.
      if (last) return;
      view.distance = clamp(wheelDistance(view.distance, event.deltaY, event.deltaMode));
    },
    onPinch({
      first,
      last,
      da: [spacing, angle],
      memo,
    }: {
      first: boolean;
      last: boolean;
      da: [number, number];
      memo?: unknown;
    }): PinchMemo {
      const start = (memo as PinchMemo | undefined) ?? {
        distance: view.distance,
        spacing,
        angle,
      };
      if (first) zoomSound();
      pinching = !last;
      view.distance = clamp(pinchDistance(start.distance, start.spacing, spacing));
      view.turnY += twistTurn(start.angle, angle);
      return { ...start, angle };
    },
  };
}
