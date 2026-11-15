import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const played: string[] = [];
vi.mock("./audio/sfx", () => ({ playSfx: (id: string) => played.push(id) }));

const { createOfferPresentation } = await import("./shop-offer-presentation");
const { createDanceFloor } = await import("./dance/dance-floor");

function beatAt(beat: number, energy = 1) {
  return { position: () => ({ beat, energy, tempo: 120, beatsPerBar: 4 }) } as never;
}

function setup(order = 0, beat = 1) {
  let reduced = false;
  const floor = createDanceFloor(beatAt(beat), () => reduced);
  const model = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const offer = createOfferPresentation(model, { id: `offer-${order}`, order, floor });
  offer.present({});
  const feedback = model.parent!;
  const dance = feedback.parent!;
  const handoff = dance.parent!;
  const settle = (busy = false, frames = 120) => {
    for (let i = 0; i < frames; i += 1) {
      floor.update();
      offer.update(1 / 60, busy, reduced);
    }
  };
  return { offer, floor, model, feedback, dance, handoff, settle, reduce: () => (reduced = true) };
}

beforeEach(() => (played.length = 0));

describe("shop offer presentation (#774)", () => {
  it("layers root > dance > feedback > model so no two writers share a transform", () => {
    const { offer, model, feedback, dance, handoff } = setup();
    expect(handoff.parent).toBe(offer.root);
    expect(dance.parent).toBe(handoff);
    expect(feedback.parent).toBe(dance);
    expect(model.parent).toBe(feedback);
  });

  it("bobs and tilts with the beat while resting in its slot", () => {
    const { dance, settle } = setup();
    settle();
    // One beat into a four-beat bar: a quarter of the cycle, the top of the bob.
    expect(dance.position.y).toBeCloseTo(0.03, 3);
    expect(Math.abs(dance.rotation.z)).toBeLessThanOrEqual(THREE.MathUtils.degToRad(4) + 1e-9);
  });

  it("offsets each offer's phase by stable stock order", () => {
    const first = setup(0, 0);
    const second = setup(1, 0);
    first.settle();
    second.settle();
    expect(first.dance.position.y).toBeCloseTo(0, 5);
    // A quarter beat later through a four-beat bar: a sixteenth of the cycle.
    expect(second.dance.position.y).toBeCloseTo(0.03 * Math.sin(Math.PI / 8), 4);
  });

  it("keeps the displayed pose when an action takes over, then gives it back smoothly", () => {
    const { offer, model, dance, handoff, settle } = setup();
    offer.input("input.enter");
    settle();
    model.updateWorldMatrix(true, false);
    const shown = model.matrixWorld.clone();
    settle(true);
    model.updateWorldMatrix(true, false);
    // Carried: the world pose is unchanged however long the action lasts.
    expect(
      model.matrixWorld.equals(shown) ||
        model.matrixWorld.elements.every((v, i) => Math.abs(v - shown.elements[i]!) < 1e-9),
    ).toBe(true);
    expect(dance.position.y).toBe(0);
    // At rest again, the hand-off eases away rather than snapping.
    offer.update(1 / 60, false, false);
    expect(handoff.position.y).toBeGreaterThan(0.02);
    settle(false);
    expect(handoff.position.y).toBeCloseTo(0, 4);
  });

  it("does not dance with reduced motion", () => {
    const { dance, settle, reduce } = setup();
    reduce();
    settle();
    expect(dance.position.y).toBe(0);
    expect(dance.rotation.z).toBe(0);
  });

  it("enlarges only the hovered offer and returns on leave, with one hover sound", () => {
    const a = setup(0);
    const b = setup(1);
    a.offer.input("input.enter");
    a.offer.input("input.focus");
    a.settle();
    b.settle();
    expect(a.feedback.scale.x).toBeCloseTo(1.04, 3);
    expect(b.feedback.scale.x).toBeCloseTo(1, 5);
    expect(played).toEqual(["ui.hover"]);
    a.offer.input("input.leave");
    a.offer.input("input.blur");
    a.settle();
    expect(a.feedback.scale.x).toBeCloseTo(1, 4);
  });

  it("gives no hover emphasis while busy", () => {
    const { offer, feedback, settle } = setup();
    offer.update(0, true, false);
    offer.input("input.enter");
    settle(true);
    expect(feedback.scale.x).toBeCloseTo(1, 5);
    expect(played).toEqual([]);
  });

  it("leaves the dance floor on disposal", () => {
    const { offer, dance, floor } = setup();
    offer.dispose();
    const before = dance.position.y;
    floor.update();
    expect(dance.position.y).toBe(before);
  });

  it("rests and leaves the floor when the controller stops presenting, rejoining once", () => {
    const { offer, dance, feedback, settle } = setup();
    offer.input("input.enter");
    settle();
    offer.present(null);
    expect(dance.position.y).toBe(0);
    expect(feedback.scale.x).toBe(1);
    settle();
    expect(dance.position.y).toBe(0);
    offer.present({});
    settle();
    expect(dance.position.y).toBeCloseTo(0.03, 3);
  });
});
