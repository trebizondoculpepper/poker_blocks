import { describe, expect, it } from "vite-plus/test";
import { createVisualScheduler, unitMs, visualHandlers } from "../visual-events/scheduler";
import {
  labelAnchorSpaces,
  labelGap,
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
