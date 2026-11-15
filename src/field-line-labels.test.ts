import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { createFieldLineAnchors, lineScoreLabel, lineScoreText } from "./field-line-labels";
import { withLineAlongside } from "./play-presenter";
import { labelAnchorSpaces, type ActivationLabelPayload } from "./visual/activation-labels";

/** A front-on orthographic camera: world x/y −5..5 maps onto a 200×100 canvas. */
function setup() {
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  const cube = (id: string, x: number) => {
    const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    object.position.set(x, 0, 0);
    return { id, object };
  };
  let cubes = [cube("a", -1), cube("b", 0), cube("c", 1), cube("other", 4)];
  const anchors = createFieldLineAnchors({
    cubes: () => cubes,
    camera: () => camera,
    canvas: { getBoundingClientRect: () => ({ left: 50, top: 20, width: 200, height: 100 }) },
    host: { getBoundingClientRect: () => ({ left: 10, top: 10 }) },
  });
  return { anchors, remove: (id: string) => (cubes = cubes.filter((c) => c.id !== id)) };
}

describe("fitted line-score labels (#1158; doc/presentation-contracts.md)", () => {
  it("anchors over the projected bounds of the line's own rendered blocks", () => {
    const { anchors } = setup();
    const anchor = anchors.anchorOf(["a", "b", "c"])()!;
    // x −1.5..1.5 → canvas 70..130, plus the canvas's offset in the host (40, 10).
    expect(anchor.bounds!.x).toBeCloseTo(110);
    expect(anchor.bounds!.width).toBeCloseTo(60);
    // y −0.5..0.5 → canvas 45..55 (y down), plus 10.
    expect(anchor.bounds!.y).toBeCloseTo(55);
    expect(anchor.bounds!.height).toBeCloseTo(10);
  });

  it("follows the line live and ends once its blocks are all gone", () => {
    const { anchors, remove } = setup();
    const live = anchors.anchorOf(["a", "b"]);
    const before = live()!.bounds!.width;
    remove("a");
    expect(live()!.bounds!.width).toBeLessThan(before);
    remove("b");
    expect(live()).toBeNull();
  });

  it("resolves through the registered fieldLine anchor space", () => {
    const { anchors } = setup();
    const space = labelAnchorSpaces.get("fieldLine");
    expect(space(["a"], { fieldLines: anchors })()).not.toBeNull();
    expect(space(["a"], {})()).toBeNull();
  });

  it("says only what was captured: generic wording and the points", () => {
    expect(lineScoreText(40)).toBe("Line\n+40");
    expect(lineScoreText(0)).toBe("Line\n+0");
    const event = lineScoreLabel({ blockIds: ["a", "b"], points: 120 }, 9);
    expect(event.handler).toBe("activationLabel");
    expect(event.payload as ActivationLabelPayload).toEqual({
      text: "Line\n+120",
      space: "fieldLine",
      anchor: ["a", "b"],
      durationUnits: 9,
      placement: "overBounds",
    });
  });

  it("puts the line's own label before its activations' labels", () => {
    const line = {
      blockIds: ["a"],
      sourceIds: [],
      points: 5,
      alongside: [{ handler: "x", payload: 1 }],
    };
    const own = withLineAlongside(line, (captured) => lineScoreLabel(captured, 9));
    expect(own.alongside!.map(({ handler }) => handler)).toEqual(["activationLabel", "x"]);
    expect(withLineAlongside(line, () => null)).toBe(line);
  });
});
