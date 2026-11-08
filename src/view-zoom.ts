/** Camera input, adapted from simulation_of_boring_things' first-person controls. */
export const minViewZoom = 0.65;
export const maxViewZoom = 4;
export const boardBaseFov = 43;

function clampZoom(zoom: number): number {
  return Math.max(minViewZoom, Math.min(maxViewZoom, zoom));
}

/** Normalise wheel units and cap one event so a hard flick cannot jump to a limit. */
export function wheelZoom(zoom: number, deltaY: number, deltaMode: number): number {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1);
  const step = Math.max(-200, Math.min(200, pixels));
  return clampZoom(zoom * Math.exp(-step * 0.0015));
}

/** A pinch is relative to the finger spacing at the start of that gesture. */
export function pinchZoom(zoom: number, from: number, to: number): number {
  if (from <= 0 || to <= 0) return zoom;
  return clampZoom((zoom * to) / from);
}

/** Convert magnification to perspective FOV while preserving the default at 1x. */
export function fovForZoom(zoom: number): number {
  const half = (boardBaseFov * Math.PI) / 360;
  return (360 / Math.PI) * Math.atan(Math.tan(half) / clampZoom(zoom));
}
