import { describe, expect, it } from "vite-plus/test";
import { createVisualScheduler, unitMs, visualHandlers } from "../visual-events/scheduler";
import {
  labelAnchorSpaces,
  labelGap,
  labelPlacements,
  overBoundsBudget,
  placeLabels,
  type ActivationLabelLayer,
  type Point,
} from "./activation-labels";

const bounds = { width: 400, height: 300 };
const label = (x: number, y: number) => ({ width: 60, height: 20, anchor: { x, y } });
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("label placement (#918)", () => {
  it("centres a label just above its anchor", () => {
    expect(placeLabels([label(200, 150)], bounds)).toEqual([
      { x: 170, y: 150 - labelGap - 20, width: 60, height: 20 },
    ]);
  });

  it("keeps labels inside the layer, portrait and landscape", () => {
    for (const size of [bounds, { width: 200, height: 500 }]) {
      for (const [x, y] of [
        [0, 0],
        [size.width, 0],
        [0, size.height],
        [size.width, size.height],
      ]) {
        const [rect] = placeLabels([label(x!, y!)], size);
        expect(rect!.x).toBeGreaterThanOrEqual(labelGap);
        expect(rect!.y).toBeGreaterThanOrEqual(labelGap);
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(size.width - labelGap);
        expect(rect!.y + rect!.height).toBeLessThanOrEqual(size.height - labelGap);
      }
    }
  });

  it("moves later labels clear of earlier ones, deterministically", () => {
    const requests = [label(200, 150), label(205, 150), label(210, 152)];
    const rects = placeLabels(requests, bounds);
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i]!, rects[j]!)).toBe(false);
    expect(placeLabels(requests, bounds)).toEqual(rects);
    // The first label keeps its place: showing order decides who moves.
    expect(rects[0]).toEqual(placeLabels([requests[0]!], bounds)[0]);
  });

  it("goes below its anchor when there is no room above", () => {
    const [rect] = placeLabels([label(200, 10)], bounds);
    expect(rect!.y).toBe(10 + labelGap);
  });
});

/** A layer that records what it shows instead of drawing. */
function fakeLayer() {
  const shown: { text: string; anchor: () => Point | null; removed: boolean }[] = [];
  const layer: ActivationLabelLayer = {
    show(text, anchor) {
      const entry = { text, anchor, removed: false };
      shown.push(entry);
      return { refresh: () => anchor() !== null, remove: () => void (entry.removed = true) };
    },
    dispose() {},
  };
  return { layer, shown };
}

describe("the activationLabel scheduler handler (#918)", () => {
  let source: Point | null = { x: 10, y: 10 };
  if (!labelAnchorSpaces.has("testSpace"))
    labelAnchorSpaces.register("testSpace", () => () => source);

  const harness = () => {
    const { layer, shown } = fakeLayer();
    const scheduler = createVisualScheduler({
      handlers: visualHandlers,
      services: { activationLabels: layer },
    });
    const scope = scheduler.createScope(null);
    const payload = { text: "+6", space: "testSpace", anchor: "die", durationUnits: 6 };
    return { scheduler, scope, shown, payload };
  };

  it("shows the text for exactly its interval, then removes it", () => {
    source = { x: 10, y: 10 };
    const { scheduler, scope, shown, payload } = harness();
    scheduler.schedule(scope, { handler: "activationLabel", payload, dueUnits: 0 });
    scheduler.update(0, true);
    scheduler.update(1, true);
    expect(shown.map(({ text, removed }) => [text, removed])).toEqual([["+6", false]]);
    scheduler.update(5 * unitMs, true);
    expect(shown[0]!.removed).toBe(false);
    scheduler.update(6 * unitMs + 2, true);
    expect(shown[0]!.removed).toBe(true);
  });

  it("shows nothing when it starts after its interval has already ended", () => {
    source = { x: 10, y: 10 };
    const { scheduler, scope, shown, payload } = harness();
    scheduler.update(0, true);
    scheduler.schedule(scope, { handler: "activationLabel", payload, dueUnits: 0 });
    // The next frame comes a second later: the six-unit interval (400 ms) has passed.
    scheduler.update(1000, true);
    expect(shown).toHaveLength(0);
  });

  it("removes the label when its scope is cancelled", () => {
    source = { x: 10, y: 10 };
    const { scheduler, scope, shown, payload } = harness();
    scheduler.schedule(scope, { handler: "activationLabel", payload, dueUnits: 0 });
    scheduler.update(0, true);
    scheduler.update(1, true);
    scheduler.cancel(scope);
    expect(shown[0]!.removed).toBe(true);
  });

  it("ends at once when its source goes, and shows nothing for a missing one", () => {
    source = { x: 10, y: 10 };
    const { scheduler, scope, shown, payload } = harness();
    scheduler.schedule(scope, { handler: "activationLabel", payload, dueUnits: 0 });
    scheduler.update(0, true);
    scheduler.update(1, true);
    source = null;
    scheduler.update(2, true);
    expect(shown[0]!.removed).toBe(true);
    scheduler.schedule(scope, { handler: "activationLabel", payload, dueUnits: 0 });
    scheduler.update(3, true);
    expect(shown).toHaveLength(1);
  });
});

describe("over-item fitted labels (#1157; doc/presentation-contracts.md)", () => {
  it("budgets 1.6× the item's width, at least 96 and at most 240 CSS px, within the viewport", () => {
    const viewport = { width: 1000, height: 800 };
    expect(overBoundsBudget({ width: 100, height: 100 }, viewport).width).toBe(160);
    expect(overBoundsBudget({ width: 20, height: 20 }, viewport).width).toBe(96);
    expect(overBoundsBudget({ width: 400, height: 400 }, viewport).width).toBe(240);
    expect(overBoundsBudget({ width: 400, height: 400 }, { width: 80, height: 50 })).toEqual({
      width: 80,
      height: 50,
    });
  });

  it("centres each label over its item's projected bounds, never moving it above or below", () => {
    const overBounds = labelPlacements.get("overBounds");
    const place: typeof overBounds.place = (requests, viewport) =>
      overBounds.place(requests, viewport);
    const item = { x: 100, y: 200, bounds: { x: 60, y: 200, width: 80, height: 80 } };
    const rects = place(
      [
        { width: 120, height: 40, anchor: item },
        // A second label over the same item keeps its own centre: no collision avoidance.
        { width: 60, height: 20, anchor: item },
      ],
      { width: 400, height: 400 },
    );
    expect(rects[0]).toEqual({ x: 40, y: 220, width: 120, height: 40 });
    expect(rects[1]).toEqual({ x: 70, y: 230, width: 60, height: 20 });
    // At the viewport edge it is not re-anchored; the layer clips it.
    const [edge] = place(
      [
        {
          width: 120,
          height: 40,
          anchor: { x: 0, y: 0, bounds: { x: -10, y: 0, width: 20, height: 20 } },
        },
      ],
      { width: 400, height: 400 },
    );
    expect(edge.x).toBe(-60);
  });

  it("falls back to the point for a point-only provider", () => {
    const [rect] = labelPlacements
      .get("overBounds")
      .place([{ width: 50, height: 20, anchor: { x: 10, y: 10 } }], { width: 400, height: 400 });
    expect(rect).toEqual({ x: -15, y: 0, width: 50, height: 20 });
  });

  it("keeps the caption placement for labels that ask for it", () => {
    const request = { width: 40, height: 20, anchor: { x: 200, y: 150 } };
    expect(labelPlacements.get("caption").place([request], bounds)).toEqual(
      placeLabels([request], bounds),
    );
  });
});
