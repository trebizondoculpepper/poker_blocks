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
  const feedback = model.parent!;
  const dance = feedback.parent!;
  const settle = (busy = false, frames = 120) => {
    for (let i = 0; i < frames; i += 1) {
      floor.update();
      offer.update(1 / 60, busy, reduced);
    }
  };
  return { offer, floor, model, feedback, dance, settle, reduce: () => (reduced = true) };
}

beforeEach(() => (played.length = 0));

describe("shop offer presentation (#774)", () => {
  it("layers root > dance > feedback > model so no two writers share a transform", () => {
    const { offer, model, feedback, dance } = setup();
    expect(dance.parent).toBe(offer.root);
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

  it("rests the inner layers smoothly while an action owns the pose", () => {
    const { offer, dance, settle } = setup();
    settle();
    offer.update(1 / 60, true, false);
    // One frame later it has eased toward rest, not snapped.
    expect(dance.position.y).toBeGreaterThan(0.02);
    settle(true);
    expect(dance.position.y).toBeCloseTo(0, 4);
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
    a.offer.block.emit("input.enter");
    a.offer.block.emit("input.focus");
    a.settle();
    b.settle();
    expect(a.feedback.scale.x).toBeCloseTo(1.04, 3);
    expect(b.feedback.scale.x).toBeCloseTo(1, 5);
    expect(played).toEqual(["ui.hover"]);
    a.offer.block.emit("input.leave");
    a.offer.block.emit("input.blur");
    a.settle();
    expect(a.feedback.scale.x).toBeCloseTo(1, 4);
  });

  it("gives no hover emphasis while busy", () => {
    const { offer, feedback, settle } = setup();
    offer.update(0, true, false);
    offer.block.emit("input.enter");
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
    expect(offer.block.listens("input.enter")).toBe(false);
  });
});
