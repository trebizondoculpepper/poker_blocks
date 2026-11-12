import { describe, expect, it } from "vite-plus/test";
import { gameModeFor } from "../../game-modes";
import { opticsBackends } from "../../visual/optics-backends";
import { comparisonLayout, distribution } from "./room";
import { pinchDistance, twistTurn, viewControls, wheelDistance } from "./view-controls";

describe("the crystal comparison room (#524)", () => {
  it("lays out the same cards, places and turns for a seed", () => {
    const a = comparisonLayout(9, 524);
    const b = comparisonLayout(9, 524);
    expect(a.map(({ card }) => card)).toEqual(b.map(({ card }) => card));
    expect(a.map(({ position }) => position.toArray())).toEqual(
      b.map(({ position }) => position.toArray()),
    );
    expect(a.map(({ rotation }) => rotation.toArray())).toEqual(
      b.map(({ rotation }) => rotation.toArray()),
    );
    expect(comparisonLayout(9, 525).map(({ card }) => card)).not.toEqual(a.map(({ card }) => card));
  });

  it("is a developer mode offering only registered backends", () => {
    const scene = gameModeFor("dev17").scenes.find(({ id }) => id === "dev17/crystal-comparison");
    const config = scene?.traits.devCrystalComparison;
    expect(config?.backends).toEqual(["current", "approximation"]);
    for (const name of config!.backends) expect(opticsBackends.has(name)).toBe(true);
    expect(gameModeFor("dev17").traits.console).toEqual({ name: "dev17" });
  });

  it("reports frame-time median and p95", () => {
    expect(distribution([4, 1, 3, 2])).toEqual({ median: 2, p95: 4, samples: 4 });
    expect(distribution([])).toEqual({ median: 0, p95: 0, samples: 0 });
  });
});

describe("pinch zoom in the comparison room (#637 review)", () => {
  it("depends only on the finger-spacing ratio, not how many events arrive", () => {
    // Doubling the spacing halves the distance, in one event or in ten.
    expect(pinchDistance(10, 100, 200)).toBe(5);
    let last = 10;
    for (let step = 1; step <= 10; step++) last = pinchDistance(10, 100, 100 + step * 10);
    expect(last).toBe(5);
  });
});

describe("wheel zoom in the comparison room (#637 review)", () => {
  it("is exponential: steps compose the same however they are split, and opposites cancel", () => {
    const once = wheelDistance(10, 100, 0);
    const twice = wheelDistance(wheelDistance(10, 50, 0), 50, 0);
    expect(twice).toBeCloseTo(once, 10);
    expect(wheelDistance(wheelDistance(10, 120, 0), -120, 0)).toBeCloseTo(10, 10);
  });
});

describe("two-finger twist in the comparison room (#637 review)", () => {
  it("turns by the change in finger angle, summing to the whole twist", () => {
    expect(twistTurn(10, 100)).toBeCloseTo(Math.PI / 2, 10);
    let turned = 0;
    let previous = 0;
    for (const angle of [15, 45, 90]) {
      turned += twistTurn(previous, angle);
      previous = angle;
    }
    expect(turned).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe("the comparison room's gesture lifecycle (#637 review)", () => {
  const setup = () => {
    const view = { distance: 10, turnX: 0, turnY: 0 };
    const sounds: string[] = [];
    return { view, sounds, controls: viewControls(view, () => void sounds.push("zoom")) };
  };

  it("does not turn the collection by drag while a straight pinch is active", () => {
    const { view, controls } = setup();
    const memo = controls.onPinch({ first: true, last: false, da: [100, 0] });
    // The first finger's movement still arrives as a drag during the pinch.
    controls.onDrag({ delta: [40, 25] });
    controls.onPinch({ first: false, last: false, da: [200, 0], memo });
    expect(view.turnX).toBe(0);
    expect(view.turnY).toBe(0);
    expect(view.distance).toBe(5);
    controls.onPinch({ first: false, last: true, da: [200, 0], memo });
    // Once the pinch ends, a drag turns it again.
    controls.onDrag({ delta: [100, 0] });
    expect(view.turnY).toBeCloseTo(1, 10);
  });

  it("applies one wheel tick once, ignoring the synthetic end callback", () => {
    const { view, sounds, controls } = setup();
    const event = { deltaY: 100, deltaMode: 0 };
    controls.onWheel({ first: true, last: false, event });
    controls.onWheel({ first: false, last: true, event });
    expect(view.distance).toBeCloseTo(wheelDistance(10, 100, 0), 10);
    expect(sounds).toEqual(["zoom"]);
  });
});

describe("turning the comparison collection plays a sound (#637 review)", () => {
  it("plays the view-turn sound once as a drag begins, not during a pinch", () => {
    const view = { distance: 10, turnX: 0, turnY: 0 };
    const sounds: string[] = [];
    const controls = viewControls(
      view,
      () => void sounds.push("zoom"),
      () => void sounds.push("rotate"),
    );
    controls.onDrag({ first: true, delta: [5, 0] });
    controls.onDrag({ first: false, delta: [5, 0] });
    expect(sounds).toEqual(["rotate"]);
    controls.onPinch({ first: true, last: false, da: [100, 0] });
    controls.onDrag({ first: true, delta: [5, 0] });
    expect(sounds).toEqual(["rotate", "zoom"]);
  });
});
