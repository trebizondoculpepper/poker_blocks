import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useAppearanceClock } from "./appearance-clock";
import {
  composeShellFree,
  containedContents,
  containedInclusions,
  createInteriorBoundary,
  setContainedReducedMotion,
  worldUpInBlock,
  type Capabilities,
  type ContainedFrame,
} from "./contained";
import { setFullVolumeDiagnostics } from "./full-volume";
import "./filled-vessel";
import "./rising-bubbles";

const geometry = new THREE.BoxGeometry(1, 1, 1);
const bubbles = {
  count: 30,
  rise: 0.4,
  wobble: 0,
  size: 0.08,
  rest: 0.05,
  colour: 0xffffff,
  opacity: 0.7,
};

/** A tilted, nonuniformly scaled block transform. */
function skewed(): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(2, 1, -3),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0.3, -0.4)),
    new THREE.Vector3(1, 2.5, 0.6),
  );
}

const frameOf = (toWorld: THREE.Matrix4, reducedMotion = false): ContainedFrame => ({
  seconds: 0,
  delta: 1 / 60,
  first: false,
  rotation: new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().extractRotation(toWorld),
  ),
  toWorld,
  reducedMotion,
});

const restores: (() => void)[] = [];
afterEach(() => restores.splice(0).forEach((restore) => restore()));

describe("world up in a block's own space (#1230)", () => {
  it("is plain up for an untransformed block, and the turned-back up for a turned one", () => {
    const normal = new THREE.Vector3();
    const rise = new THREE.Vector3();
    expect(worldUpInBlock(new THREE.Matrix4(), normal, rise)).toBe(true);
    expect(normal.toArray()).toEqual([0, 1, 0]);
    expect(rise.toArray()).toEqual([0, 1, 0]);
    const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.7, 0, 0.2));
    worldUpInBlock(new THREE.Matrix4().makeRotationFromQuaternion(turn), normal, rise);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(turn.clone().invert());
    expect(normal.distanceTo(up)).toBeLessThan(1e-9);
    expect(rise.distanceTo(up)).toBeLessThan(1e-9);
  });

  it("keeps the level plane's normal and the rising direction apart under nonuniform scale", () => {
    const toWorld = skewed();
    const normal = new THREE.Vector3();
    const rise = new THREE.Vector3();
    worldUpInBlock(toWorld, normal, rise);
    expect(normal.angleTo(rise)).toBeGreaterThan(0.05);
    const linear = new THREE.Matrix3().setFromMatrix4(toWorld);
    // Moving along `rise` in the block moves straight up in the world.
    const moved = rise.clone().applyMatrix3(linear).normalize();
    expect(moved.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-9);
    // Points on a plane of constant dot(p, normal) share one world height.
    const along = new THREE.Vector3(1, 0, 0).cross(normal).normalize();
    const across = normal.clone().cross(along).normalize();
    const base = normal.clone().multiplyScalar(0.2);
    const height = (p: THREE.Vector3) => p.clone().applyMatrix4(toWorld).y;
    expect(height(base.clone().addScaledVector(along, 0.3))).toBeCloseTo(height(base), 9);
    expect(height(base.clone().addScaledVector(across, -0.4))).toBeCloseTo(height(base), 9);
  });

  it("refuses a transform that can't be inverted, changing nothing", () => {
    const normal = new THREE.Vector3(0, 0, 1);
    const rise = new THREE.Vector3(1, 0, 0);
    const flat = new THREE.Matrix4().makeScale(1, 0, 1);
    expect(worldUpInBlock(flat, normal, rise)).toBe(false);
    expect(normal.toArray()).toEqual([0, 0, 1]);
    expect(rise.toArray()).toEqual([1, 0, 0]);
  });
});

describe("the shell-free full volume (#1230)", () => {
  const build = () =>
    containedContents.get("fullVolume")(createInteriorBoundary(geometry, 1, 1), {});

  it("draws nothing and publishes the same capabilities a contained fluid does", () => {
    const volume = build();
    expect(volume.meshes).toHaveLength(0);
    const { liquidSurface, volume: published } = volume.capabilities;
    expect(published!.surface).toBe(liquidSurface);
    // The whole interior, at the boundary's volume scale.
    const extent = 0.5 * 0.97;
    expect(published!.bounds.max.toArray()).toEqual([extent, extent, extent]);
    expect(liquidSurface!.wet(new THREE.Vector3(extent, extent, extent))).toBe(true);
    expect(liquidSurface!.wet(new THREE.Vector3(0, extent + 0.01, 0))).toBe(false);
  });

  it("follows its block's transform: the top touches its highest point, rise goes straight up", () => {
    const volume = build();
    const toWorld = skewed();
    volume.update!(frameOf(toWorld));
    const { bounds, rise, surface } = volume.capabilities.volume!;
    const corners = Array.from(
      { length: 8 },
      (_, index) =>
        new THREE.Vector3(
          index & 1 ? bounds.max.x : bounds.min.x,
          index & 2 ? bounds.max.y : bounds.min.y,
          index & 4 ? bounds.max.z : bounds.min.z,
        ),
    );
    const highest = corners.reduce((best, each) =>
      each.clone().applyMatrix4(toWorld).y > best.clone().applyMatrix4(toWorld).y ? each : best,
    );
    expect(highest.dot(surface.normal)).toBeCloseTo(surface.height, 9);
    for (const each of corners) expect(surface.wet(each)).toBe(true);
    const moved = rise.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(toWorld));
    expect(moved.normalize().y).toBeCloseTo(1, 9);
  });

  it("says once when it can't follow a transform, and keeps its last directions", () => {
    const diagnose = vi.fn();
    restores.push(setFullVolumeDiagnostics(diagnose));
    const volume = build();
    volume.update!(frameOf(skewed()));
    const rise = volume.capabilities.volume!.rise.clone();
    volume.update!(frameOf(new THREE.Matrix4().makeScale(0, 1, 1)));
    volume.update!(frameOf(new THREE.Matrix4().makeScale(0, 1, 1)));
    expect(diagnose).toHaveBeenCalledOnce();
    expect(volume.capabilities.volume!.rise.toArray()).toEqual(rise.toArray());
  });
});

describe("bubbles in a shell-free full volume (#1230)", () => {
  /** A block holding a shell-free full volume with bubbles, drawn by stepping its parts. */
  function scene(toWorld = skewed()) {
    let seconds = 0;
    restores.push(useAppearanceClock(() => seconds));
    const block = new THREE.Group();
    toWorld.decompose(block.position, block.quaternion, block.scale);
    const parts = composeShellFree(
      { geometry, size: 1 },
      {
        contents: { effect: "fullVolume", config: {} },
        inclusions: [{ effect: "risingBubbles", config: bubbles }],
      },
    );
    block.add(...parts);
    block.updateMatrixWorld(true);
    const points = parts[0] as THREE.Points;
    const renderer = {
      getSize: (into: THREE.Vector2) => into.set(400, 300),
    } as unknown as THREE.WebGLRenderer;
    const camera = new THREE.PerspectiveCamera();
    const draw = (step = 1 / 60) => {
      seconds += step;
      points.onBeforeRender(
        renderer,
        new THREE.Scene(),
        camera,
        points.geometry,
        points.material as THREE.Material,
        null as never,
      );
    };
    const slots = () => {
      const p = points.geometry.getAttribute("position").array as Float32Array;
      const c = points.geometry.getAttribute("color").array as Float32Array;
      // Each pool slot: its block-local position while shown, else null.
      const slots: (THREE.Vector3 | null)[] = [];
      for (let i = 0; i < c.length; i += 3)
        slots.push(
          c[i]! > 0
            ? new THREE.Vector3(p[i], p[i + 1], p[i + 2]).applyMatrix4(points.matrix)
            : null,
        );
      return slots;
    };
    const visible = () => slots().filter((each) => each !== null);
    return { parts, points, draw, visible, slots, block };
  }

  it("has no shell: only the inclusion's own points", () => {
    const { parts } = scene();
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBeInstanceOf(THREE.Points);
  });

  it("are born and kept wholly inside the bounds, and rise straight up in the world", () => {
    const { draw, slots, block } = scene();
    for (let i = 0; i < 120; i++) draw();
    const extent = 0.5 * 0.97;
    // The sprite is drawn at the volume scale, as the points are.
    const margin = (bubbles.size / 2) * 0.97;
    let checked = 0;
    for (let i = 0; i < 60; i++) {
      const before = slots();
      draw();
      const after = slots();
      after.forEach((p, index) => {
        if (!p) return;
        for (const axis of [p.x, p.y, p.z])
          expect(Math.abs(axis)).toBeLessThanOrEqual(extent - margin + 1e-6);
        // Shown in both frames, with no wobble: it moved straight up in the world.
        const from = before[index];
        if (!from) return;
        const world = p
          .clone()
          .applyMatrix4(block.matrixWorld)
          .sub(from.clone().applyMatrix4(block.matrixWorld));
        expect(world.normalize().y).toBeCloseTo(1, 6);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("the contents update before the inclusion, in one frame", () => {
    const order: string[] = [];
    containedInclusions.register("orderProbe", {
      requires: "volume",
      build: (_, capabilities: Capabilities) => ({
        meshes: [new THREE.Mesh()],
        update: () => order.push(`probe sees ${capabilities.volume!.rise.y.toFixed(3)}`),
      }),
    });
    let seconds = 0;
    restores.push(useAppearanceClock(() => seconds));
    const block = new THREE.Group();
    block.rotation.x = Math.PI / 2;
    const [probe] = composeShellFree(
      { geometry, size: 1 },
      {
        contents: { effect: "fullVolume", config: {} },
        inclusions: [{ effect: "orderProbe", config: {} }],
      },
    );
    block.add(probe!);
    block.updateMatrixWorld(true);
    seconds = 1;
    probe!.onBeforeRender(
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
    // Turned a quarter about x: world up is the block's -z, so rise.y is 0 on the very first frame.
    expect(order).toEqual(["probe sees 0.000"]);
  });

  it("hold still under reduced motion", () => {
    const { draw, visible } = scene();
    for (let i = 0; i < 60; i++) draw();
    restores.push(setContainedReducedMotion(() => true));
    const before = visible().map((p) => p.toArray());
    for (let i = 0; i < 30; i++) draw();
    expect(visible().map((p) => p.toArray())).toEqual(before);
  });

  it("release their geometry with their material", () => {
    const { points } = scene();
    const released = vi.fn();
    points.geometry.addEventListener("dispose", released);
    (points.material as THREE.Material).dispose();
    expect(released).toHaveBeenCalledOnce();
  });

  it("are never born in a volume too small for them", () => {
    const tiny = containedContents.get("fullVolume")(createInteriorBoundary(geometry, 1, 1), {});
    const boundary = createInteriorBoundary(geometry, 1, 1);
    const built = containedInclusions
      .get("risingBubbles")
      .build(boundary, tiny.capabilities, { ...bubbles, size: 1.2 });
    for (let i = 0; i < 60; i++)
      built.update!({ ...frameOf(new THREE.Matrix4()), seconds: i / 60 });
    const colours = (built.meshes[0] as THREE.Points).geometry.getAttribute("color")
      .array as Float32Array;
    expect(Array.from(colours).every((each) => each === 0)).toBe(true);
  });
});

describe("a contained fluid publishes the same volume (#1230)", () => {
  it("rises straight up at once, while its surface eases toward level", () => {
    const fluid = containedContents.get("levellingFluid")(
      createInteriorBoundary(geometry, 1, 0.9),
      {
        level: 0.6,
        settleSeconds: 1,
        look: { id: "opaqueFluid", config: { fill: 0xffffff, surface: 0xffffff } },
      },
    );
    const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6, 0, 0));
    const toWorld = new THREE.Matrix4().makeRotationFromQuaternion(turn);
    fluid.update!({ ...frameOf(new THREE.Matrix4()), seconds: 0 });
    fluid.update!({ ...frameOf(toWorld), seconds: 0.05 });
    const { rise, surface } = fluid.capabilities.volume!;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(turn.clone().invert());
    expect(rise.distanceTo(up)).toBeLessThan(1e-9);
    expect(surface.normal.distanceTo(up)).toBeGreaterThan(0.01);
    expect(surface).toBe(fluid.capabilities.liquidSurface);
  });
});
