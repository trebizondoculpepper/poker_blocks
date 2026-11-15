import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { profilingCases } from "./cases";
import "./material-cases";
import { experimentalMaterials, materialDefinitions } from "../../materials";
import { materialCaseId, poseFedParts } from "./material-cases";
import { displayName, rowKey } from "./motion-description";
import { profilingMotions, quarterTurns, recordedMotion, stationary } from "./motion";

/** The turn a driver gives at `seconds`. */
function turnAt(reference: typeof quarterTurns, seconds: number): THREE.Quaternion {
  const turn = new THREE.Quaternion();
  profilingMotions.get(reference.driver).create(reference.config ?? {})(seconds, turn);
  return turn;
}

/** How far a driver has tipped world up at `seconds`: the angle about its (horizontal) axis. */
function angleAt(reference: typeof quarterTurns, seconds: number): number {
  const tipped = new THREE.Vector3(0, 1, 0).applyQuaternion(turnAt(reference, seconds));
  return Math.atan2(tipped.z, tipped.y);
}

describe("profiling motion drivers (#973)", () => {
  it("turns a quarter over one second, holds a second, and repeats from where it ended", () => {
    const quarter = Math.PI / 2;
    expect(angleAt(quarterTurns, 0)).toBeCloseTo(0);
    expect(angleAt(quarterTurns, 0.5)).toBeCloseTo(quarter / 2);
    expect(angleAt(quarterTurns, 0.25)).toBeLessThan(quarter / 4); // eased in
    expect(angleAt(quarterTurns, 1)).toBeCloseTo(quarter);
    expect(angleAt(quarterTurns, 1.9)).toBeCloseTo(quarter); // held
    expect(angleAt(quarterTurns, 2.5)).toBeCloseTo(quarter * 1.5);
    expect(angleAt(quarterTurns, 3.5)).toBeCloseTo(quarter * 2);
  });

  it("is the same turn for the same time: deterministic", () => {
    expect(angleAt(quarterTurns, 2.37)).toBe(angleAt(quarterTurns, 2.37));
  });

  it("leaves a stationary row at rest", () => {
    expect(angleAt(stationary, 0)).toBeCloseTo(0);
    expect(angleAt(stationary, 7)).toBeCloseTo(0);
  });

  it("names a motion row apart from its stationary row, and a stationary row as before", () => {
    const at = { id: "material:custard", label: "Custard", motion: recordedMotion(stationary) };
    const turning = { ...at, motion: recordedMotion(quarterTurns) };
    expect(rowKey(at)).toBe("material:custard");
    expect(displayName(at)).toBe("Custard");
    expect(rowKey(turning)).not.toBe(rowKey(at));
    expect(displayName(turning)).toBe("Custard (quarter turns)");
    expect(displayName({ ...turning, phase: "exit" })).toBe("Custard (exit, quarter turns)");
  });
});

describe("the standard motion drives gravity-fed parts (#973 review)", () => {
  it("tips the block so which way is down inside it changes", () => {
    const localUp = (seconds: number) =>
      new THREE.Vector3(0, 1, 0).applyQuaternion(turnAt(quarterTurns, seconds).invert());
    expect(localUp(0).angleTo(localUp(1))).toBeCloseTo(Math.PI / 2);
  });

  it("makes a production levelling fluid slosh: its surface leaves level, then settles again", async () => {
    const { createSettler } = await import("../../visual/filled-vessel");
    const settle = createSettler({ settleSeconds: 0.6, traceSeconds: 4 });
    const surface = new THREE.Vector3();
    const trace = new THREE.Vector3();
    const step = 1 / 60;
    const resting = new THREE.Quaternion();
    const tilt = (seconds: number) => turnAt(quarterTurns, seconds).multiply(resting);
    settle(tilt(0), 0, surface, trace);
    const level = surface.clone();
    let furthest = 0;
    for (let t = step; t <= 2; t += step) {
      settle(tilt(t), t, surface, trace);
      furthest = Math.max(furthest, surface.angleTo(level));
    }
    // It moved with the turn, toward the block's new local up.
    expect(furthest).toBeGreaterThan(0.5);
    const newUp = new THREE.Vector3(0, 1, 0).applyQuaternion(tilt(2).invert());
    expect(surface.angleTo(newUp)).toBeLessThan(0.3);
  });
});

describe("material recipes declare motion from their composition (#973)", () => {
  const all = [...materialDefinitions, ...experimentalMaterials];

  it("turns exactly the looks with parts fed by the block's pose", () => {
    for (const definition of all) {
      const motions = profilingCases.get(materialCaseId(definition)).motions ?? [];
      expect(motions.length > 0).toBe(poseFedParts(definition).length > 0);
    }
  });

  it("has both kinds in the catalogue: nothing spins universally", () => {
    const turning = all.filter((definition) => poseFedParts(definition).length);
    expect(turning.length).toBeGreaterThan(0);
    expect(turning.length).toBeLessThan(all.length);
  });
});
