import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { createVisualScheduler, unitMs } from "../visual-events/scheduler";
import {
  fallAt,
  requestAttachmentRelease,
  swingAt,
  type ReleaseTarget,
} from "./attachment-release";

function harness(reducedMotion = false) {
  const scheduler = createVisualScheduler();
  let now = 0;
  scheduler.update(0, true);
  const step = (ms: number) => {
    for (let t = 0; t < ms; t += 10) scheduler.update((now += 10), true);
  };
  const room = new THREE.Group();
  const object = new THREE.Mesh(new THREE.PlaneGeometry(2, 1));
  object.position.set(1, 2, -5);
  room.add(object);
  const target: ReleaseTarget = {
    object,
    attachments: new Map([
      ["left", new THREE.Vector3(-1, 0.5, 0)],
      ["right", new THREE.Vector3(1, 0.5, 0)],
    ]),
  };
  const cues: string[] = [];
  const start = () => {
    const scope = scheduler.createScope(null);
    scheduler.schedule(
      scope,
      requestAttachmentRelease(target, { reducedMotion, impact: (cue) => cues.push(cue) }),
    );
    scheduler.seal(scope);
    return scope;
  };
  const world = (name: string) =>
    target.attachments.get(name)!.clone().applyMatrix4(object.matrixWorld);
  return { scheduler, step, object, start, cues, world, room };
}

describe("triggered attachment release (#1065; doc/line-goes-up.md)", () => {
  it("swings about the right nail with the left side dropping, then falls and cues once", () => {
    const { step, object, start, cues, world, room } = harness();
    room.updateMatrixWorld(true);
    const pivot = world("right");
    const leftBefore = world("left");
    start();
    step(3 * unitMs);
    room.updateMatrixWorld(true);
    // The pivot holds still through the swing; the released side has dropped.
    expect(world("right").distanceTo(pivot)).toBeLessThan(1e-6);
    expect(world("left").y).toBeLessThan(leftBefore.y);
    step(6 * unitMs);
    room.updateMatrixWorld(true);
    expect(world("right").y).toBeLessThan(pivot.y);
    expect(cues).toEqual([]);
    step(10 * unitMs);
    expect(cues).toEqual(["picture.impact"]);
    expect(object.visible).toBe(false);
    step(10 * unitMs);
    expect(cues).toEqual(["picture.impact"]);
  });

  it("cancelling settles once with no impact", () => {
    const { scheduler, step, start, cues } = harness();
    const scope = start();
    step(2 * unitMs);
    scheduler.cancel(scope);
    step(20 * unitMs);
    expect(cues).toEqual([]);
  });

  it("reduced motion goes straight to a hidden, settled picture with one cue", () => {
    const { step, object, start, cues } = harness(true);
    const before = object.position.clone();
    start();
    step(20);
    expect(object.visible).toBe(false);
    expect(object.position.toArray()).toEqual(before.toArray());
    expect(cues).toEqual(["picture.impact"]);
  });

  it("eases: the swing settles at its angle and the fall accelerates", () => {
    expect(swingAt(0, 0.12)).toBe(0);
    expect(swingAt(1, 0.12)).toBeCloseTo(1);
    expect(Math.max(...[0.6, 0.7, 0.8].map((t) => swingAt(t, 0.12)))).toBeGreaterThan(1);
    expect(fallAt(0.5)).toBeLessThan(0.5);
    expect(fallAt(1)).toBe(1);
  });
});
