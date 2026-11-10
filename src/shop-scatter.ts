/**
 * The shop's circular scatter (#122): where each offer sits inside the round stock area. The
 * spots are predefined, one arrangement per supported stock size (5 to 9 offers, #145), hand
 * placed as a jittered ring around a centre spot so the stock looks casually laid out without
 * any runtime randomness.
 *
 * Coordinates are in units of the area's radius, from its centre (+x right, +y down). Every
 * offer is drawn in a square `spotSize` across, so two squares never overlap when their centres
 * are at least `spotSize` apart across or down (not just diagonally), and a square stays inside
 * the circle when its centre is within `1 - spotSize / √2` of the middle. `src/shop-scatter.test.ts` checks both for every count.
 */

export type Spot = { readonly x: number; readonly y: number };

/** An offer's width and height, in radius units: a little under a fifth of the area across, leaving a gap between the closest spots. */
export const spotSize = 0.38;

const arrangements: Readonly<Record<number, readonly Spot[]>> = {
  5: spots([0.19, -0.62], [0.5, -0.12], [0.16, 0.54], [-0.41, 0.32], [-0.41, -0.26]),
  6: spots([0.06, -0.04], [0.39, -0.54], [0.61, 0.07], [0.02, 0.66], [-0.55, 0.33], [-0.4, -0.51]),
  7: spots(
    [-0.04, 0.07],
    [0.24, -0.67],
    [0.61, -0.18],
    [0.48, 0.52],
    [-0.09, 0.69],
    [-0.6, 0.09],
    [-0.47, -0.39],
  ),
  8: spots(
    [-0.06, -0.04],
    [0.31, -0.65],
    [0.63, -0.17],
    [0.57, 0.39],
    [0.03, 0.62],
    [-0.54, 0.41],
    [-0.66, -0.13],
    [-0.25, -0.66],
  ),
  // Nine fills the circle, so it is a staggered three by three.
  9: spots(
    [-0.47, -0.49],
    [0.02, -0.5],
    [0.5, -0.46],
    [-0.51, 0],
    [-0.02, -0.02],
    [0.47, 0.03],
    [-0.45, 0.49],
    [0.04, 0.47],
    [0.5, 0.5],
  ),
};

/** The stock sizes with a hand-placed arrangement. */
export const scatterCounts = Object.keys(arrangements).map(Number);

/**
 * The spots for a stock of `count` offers. A size without a hand-placed arrangement (a smaller
 * stock in a developer mode, say) falls back to an even ring, which also never overlaps for
 * up to nine offers.
 */
export function scatterSpots(count: number): readonly Spot[] {
  return arrangements[count] ?? ring(count);
}

/**
 * Keeps each offer on its spot while the stock changes (#122: no jitter during updates). An
 * offer still showing keeps the spot it had; when the shown offers are not all from the last
 * arrangement (a new stock), the whole stock is laid out afresh for its size.
 */
export function createScatterPlacer(): (ids: readonly string[]) => ReadonlyMap<string, Spot> {
  let placed = new Map<string, Spot>();
  return (ids) => {
    if (!ids.every((id) => placed.has(id))) {
      const fresh = scatterSpots(ids.length);
      placed = new Map(ids.map((id, index) => [id, fresh[index]!]));
    }
    return new Map(ids.map((id) => [id, placed.get(id)!]));
  };
}

function ring(count: number): Spot[] {
  const radius = count <= 1 ? 0 : 0.6;
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
}

function spots(...points: [number, number][]): Spot[] {
  return points.map(([x, y]) => ({ x, y }));
}
