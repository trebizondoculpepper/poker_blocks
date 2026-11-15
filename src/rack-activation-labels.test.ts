import { describe, expect, it } from "vite-plus/test";
import { pulseMilliseconds } from "./activation-pulse";
import { standardDeck } from "./cards";
import { passiveActivation, rackActivationLabel } from "./passive-rack";
import { scoreFieldWithPassives, type RuleActivation } from "./passive-effects";
import { createPassiveBlock } from "./passives";
import { capturedLine } from "./play-presenter";
import { labelAnchorSpaces, type ActivationLabelPayload } from "./visual/activation-labels";
import { unitMs } from "./visual-events/scheduler";

const field = standardDeck.slice(0, 5).map((block, x) => ({ block, cell: { x, y: 0, z: 0 } }));

describe("rack activation labels (#919)", () => {
  it("labels a die's committed activation with its actual roll, for as long as its pulse", () => {
    const die = createPassiveBlock("d6", "passive.1");
    const [line] = scoreFieldWithPassives(field, [die], undefined, () => 0.99);
    const rolled = line!.activations.find(({ sourceId }) => sourceId === "passive.1")!;
    const label = rackActivationLabel(die, rolled)!;
    expect(label.handler).toBe("activationLabel");
    const payload = label.payload as ActivationLabelPayload;
    expect(payload).toEqual({
      text: "+6",
      space: "rack",
      anchor: "passive.1",
      durationUnits: pulseMilliseconds(passiveActivation(die).effect) / unitMs,
      // Centred over the item (#1157).
      placement: "overBounds",
    });
  });

  it("shows nothing for an activation with nothing to say", () => {
    const die = createPassiveBlock("d6", "passive.1");
    const quiet: RuleActivation = {
      sourceId: "passive.1",
      sourceDescription: "D6",
      on: "score.line",
      commands: [],
      outcomes: [],
    };
    expect(rackActivationLabel(die, quiet)).toBeNull();
  });

  it("captures what each activation's host shows, in committed order, skipping none-shown", () => {
    const first = createPassiveBlock("d6", "passive.1");
    const second = createPassiveBlock("d6", "passive.2");
    const [line] = scoreFieldWithPassives(field, [first, second], undefined, () => 0.99);
    const hosts = new Map([[first.id, first]]);
    const captured = capturedLine(line!, (activation) => {
      const block = hosts.get(activation.sourceId);
      return block ? rackActivationLabel(block, activation) : null;
    });
    const anchors = captured.alongside!.map(
      ({ payload }) => (payload as ActivationLabelPayload).anchor,
    );
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.every((anchor) => anchor === "passive.1")).toBe(true);
    // Without a host, a line shows nothing alongside it.
    expect(capturedLine(line!).alongside).toEqual([]);
  });

  it("anchors to the rack service's live slot point, or to nothing without a rack", () => {
    const space = labelAnchorSpaces.get("rack");
    const point = { x: 40, y: 12 };
    const rack = {
      anchorOf: (id: string) => () => (id === "passive.1" ? point : null),
    };
    expect(space("passive.1", { passiveRack: rack })()).toEqual(point);
    expect(space("passive.9", { passiveRack: rack })()).toBeNull();
    expect(space("passive.1", {})()).toBeNull();
  });
});

describe("rack label anchors follow the rendered token (#1213)", () => {
  it("projects the token's own bounds, so a moving token moves its label", async () => {
    const THREE = await import("three");
    const { projectedBounds } = await import("./passive-rack");
    const camera = new THREE.OrthographicCamera(-2, 2, 1, -1, 0.1, 30);
    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);
    const token = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5));
    const canvas = { left: 100, top: 20, width: 400, height: 200 };
    const origin = { left: 0, top: 0 };
    const atSlot = projectedBounds(token, camera, canvas, origin)!;
    // 0.5 world units of a 4-unit-wide view on a 400px canvas: 50px, centred at 300.
    expect(atSlot.width).toBeCloseTo(50);
    expect(atSlot.x + atSlot.width / 2).toBeCloseTo(300);
    // Mid-reorder, the token is a world unit to the right: so is its anchor.
    token.position.x = 1;
    const moving = projectedBounds(token, camera, canvas, origin)!;
    expect(moving.x + moving.width / 2).toBeCloseTo(400);
    expect(projectedBounds(new THREE.Group(), camera, canvas, origin)).toBeNull();
  });
});
