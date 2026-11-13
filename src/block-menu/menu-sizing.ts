/**
 * Menu cube sizing (#628; doc/foreground-menus.md, "Title cube size: the Dev13 audition
 * reference"). A **reference sizing profile** describes the menu-block audition room's framing:
 * its fixed cube grid, the fit padding and field of view its camera uses, and the canvas it draws
 * into. From it, `referenceEdge` projects the front edge of a neutral unit cube into CSS pixels at
 * a given viewport, so another host can draw its cubes at that same apparent size instead of
 * fitting its own camera to however many choices it has.
 *
 * Both the audition room (its grid and spacing) and production menu hosts read these values, so
 * the reference and its consumers cannot drift apart. Nothing here knows which menu or room it is.
 */
import { attractFieldOfView } from "../visual/attract-look";

/** The distance between neighbouring cube centres, shared by every menu layout. */
export const cubeSpacing = 1.7;

/** The margin, in world units, a fitted camera leaves around its cube centres. */
export const fitMargin = 1.8;

/** Vertical room, in cube edges, a row needs: the cube plus its spring travel. */
export const rowClearance = 1.5;

/** A fitted camera stands this far further back than the bounds alone need. */
export const fitPadding = 1;

export type ReferenceSizingProfile = {
  /** World-space bounds the reference camera fits (cube-centre extents plus `fitMargin`). */
  bounds: { width: number; height: number };
  /** Vertical field of view, in degrees. */
  fieldOfView: number;
  /** How the reference canvas relates to the viewport: CSS pixels taken by its header/footer. */
  canvas: { heightInset: number };
};

/**
 * The audition room's framing: four columns and two rows of cubes `cubeSpacing` apart, in a
 * full-width canvas under a header and over a footer. The 82px inset is a source-derived
 * approximation of those bars, not a browser measurement (doc/foreground-menus.md).
 */
export const auditionSizingProfile: ReferenceSizingProfile = {
  bounds: { width: 3 * cubeSpacing + fitMargin, height: cubeSpacing + fitMargin },
  fieldOfView: attractFieldOfView,
  canvas: { heightInset: 82 },
};

/** How far back a camera fitting `bounds` stands, for a canvas of this aspect. */
export function fitDistance(
  bounds: { width: number; height: number },
  aspect: number,
  fieldOfView: number,
): number {
  const tan = Math.tan(((fieldOfView / 2) * Math.PI) / 180);
  return Math.max(bounds.height / (2 * tan), bounds.width / (2 * tan * aspect)) + fitPadding;
}

/** The on-screen size, in CSS pixels, of a neutral unit cube's front edge in the reference. */
export function referenceEdge(
  profile: ReferenceSizingProfile,
  viewport: { width: number; height: number },
): number {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height - profile.canvas.heightInset);
  const distance = fitDistance(profile.bounds, width / height, profile.fieldOfView);
  const tan = Math.tan(((profile.fieldOfView / 2) * Math.PI) / 180);
  // A unit cube's front face sits half a unit nearer the camera than its centre.
  return height / (2 * tan * (distance - 0.5));
}

/**
 * The camera distance at which a unit cube's front edge measures `edge` CSS pixels in a canvas
 * `canvasHeight` pixels tall: the inverse of `referenceEdge`'s projection.
 */
export function distanceForEdge(edge: number, canvasHeight: number, fieldOfView: number): number {
  const tan = Math.tan(((fieldOfView / 2) * Math.PI) / 180);
  return canvasHeight / (2 * tan * Math.max(1e-6, edge)) + 0.5;
}

/**
 * The edge to draw at: the reference edge, made smaller only when the host's canvas could not
 * otherwise hold every cube centre plus the fit margin (a narrow screen), so nothing is cropped.
 */
export function clampedEdge(
  edge: number,
  canvas: { width: number; height: number },
  extents: { width: number; height: number },
): number {
  const across = canvas.width / (extents.width + fitMargin);
  const down = canvas.height / (extents.height + rowClearance);
  return Math.min(edge, across, down);
}
