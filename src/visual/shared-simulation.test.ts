import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { createSharedSimulations } from "./shared-simulation";
import { createVesselSimulation } from "./filled-vessel";

describe("shared visual simulations (#230)", () => {
  it("gives every block of one configuration the same simulation, run once per frame", () => {
    const shared = createSharedSimulations();
    const config = {};
    let created = 0;
    let steps = 0;
    const create = () => {
      created++;
      return { step: (_now: number, _input: undefined) => void steps++ };
    };
    const a = shared.acquire(config, create);
    const b = shared.acquire(config, create);
    expect(a.simulation).toBe(b.simulation);
    expect(created).toBe(1);
    // Three blocks render in one frame, then one in the next.
    a.simulation.step(1, undefined);
    b.simulation.step(1, undefined);
    a.simulation.step(1, undefined);
    a.simulation.step(2, undefined);
    expect(steps).toBe(2);
  });

  it("keeps different configurations apart, and drops a simulation when no block uses it", () => {
    const shared = createSharedSimulations();
    const create = () => ({ step: () => {} });
    const one = shared.acquire({}, create);
    const other = shared.acquire({}, create);
    expect(one.simulation).not.toBe(other.simulation);
    expect(shared.size).toBe(2);
    one.release();
    one.release();
    expect(shared.size).toBe(1);
    other.release();
    expect(shared.size).toBe(0);
  });

  it("shows two vessels at the same orientation identical results, and a turned one the same world surface", () => {
    const simulation = createVesselSimulation({ settleSeconds: 1, traceSeconds: 4 });
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.6);
    const driver = {};
    simulation.step(0, { rotation: new THREE.Quaternion(), driver });
    for (let t = 0.05; t < 0.5; t += 0.05) simulation.step(t, { rotation: tilt, driver });
    const [a, b, c] = [0, 1, 2].map(() => ({
      surface: new THREE.Vector3(),
      trace: new THREE.Vector3(),
    }));
    simulation.localNormals(tilt, a!.surface, a!.trace);
    simulation.localNormals(tilt, b!.surface, b!.trace);
    expect(a!.surface.toArray()).toEqual(b!.surface.toArray());
    // A block at another orientation sees the same surface in world space.
    const other = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.1);
    simulation.localNormals(other, c!.surface, c!.trace);
    const worldA = a!.surface.clone().applyQuaternion(tilt);
    const worldC = c!.surface.clone().applyQuaternion(other);
    expect(worldC.distanceTo(worldA)).toBeLessThan(1e-9);
  });

  it("does not jump when a block at another orientation takes over driving it", () => {
    const simulation = createVesselSimulation({ settleSeconds: 1, traceSeconds: 4 });
    const first = {};
    const second = {};
    const rocked = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.4);
    simulation.step(0, { rotation: new THREE.Quaternion(), driver: first });
    simulation.step(0.016, { rotation: new THREE.Quaternion(), driver: first });
    const before = { surface: new THREE.Vector3(), trace: new THREE.Vector3() };
    simulation.localNormals(new THREE.Quaternion(), before.surface, before.trace);
    // The first block is played; a rocked hand block now renders first.
    simulation.step(0.032, { rotation: rocked, driver: second });
    const after = { surface: new THREE.Vector3(), trace: new THREE.Vector3() };
    simulation.localNormals(new THREE.Quaternion(), after.surface, after.trace);
    expect(after.surface.distanceTo(before.surface)).toBeLessThan(1e-6);
  });

  it("turns the fluid with its container when the same block turns, then levels it", () => {
    const simulation = createVesselSimulation({ settleSeconds: 1, traceSeconds: 4 });
    const driver = {};
    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.8);
    simulation.step(0, { rotation: new THREE.Quaternion(), driver });
    simulation.step(0.016, { rotation: turned, driver });
    const world = new THREE.Vector3();
    simulation.localNormals(new THREE.Quaternion(), world, new THREE.Vector3());
    expect(world.y).toBeLessThan(0.75);
    for (let t = 0.032; t < 10; t += 0.05) simulation.step(t, { rotation: turned, driver });
    simulation.localNormals(new THREE.Quaternion(), world, new THREE.Vector3());
    expect(world.y).toBeCloseTo(1, 3);
  });

  it("guardrail: an effect gets its simulation from the shared registry, never per block", () => {
    const vessel = readFileSync(new URL("./filled-vessel.ts", import.meta.url), "utf8");
    const factory = vessel.slice(vessel.indexOf("export function createVesselFluid"));
    const body = factory.slice(0, factory.indexOf("\n}\n"));
    expect(body).toContain("sharedSimulations.acquire(");
    // The per-block factory never builds a settler or simulation of its own.
    expect(body).not.toMatch(/createSettler\(|createVesselSimulation\(config\)\s*;/);
  });
});
