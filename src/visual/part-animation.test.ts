import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { bindPartAnimation, partAnimations } from "./part-animation";

/** A housing with a rotor part, as an imported model's prepared mount or a procedural one. */
function fan() {
  const housing = new THREE.Group();
  housing.position.set(5, 1, 0);
  housing.rotation.set(0.3, 0, 0);
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.1));
  rotor.position.set(0, 0.5, 0);
  housing.add(rotor);
  housing.updateMatrixWorld(true);
  return { housing, rotor };
}

const spin = { axis: [0, 0, 1] as const, revolutionsPerSecond: 1 };

describe("part animation: a configured spin (#1196; doc/imported-models.md)", () => {
  it("turns only its part, at its configured speed, on the frames it is given", () => {
    const { housing, rotor } = fan();
    const housingPose = housing.matrix.clone();
    const binding = bindPartAnimation(rotor, { animation: "spin", config: spin });
    binding.update({ delta: 0.25, reducedMotion: false });
    // A quarter revolution about z, about its own position (no pivot given).
    const turned = new THREE.Euler().setFromQuaternion(rotor.quaternion);
    expect(turned.z).toBeCloseTo(Math.PI / 2, 9);
    expect(rotor.position.toArray()).toEqual([0, 0.5, 0]);
    housing.updateMatrix();
    expect(housing.matrix.equals(housingPose)).toBe(true);
  });

  it("turns about a configured pivot, keeping its distance from it", () => {
    const { rotor } = fan();
    const binding = bindPartAnimation(rotor, {
      animation: "spin",
      config: { ...spin, pivot: [0, 0, 0] },
    });
    binding.update({ delta: 0.25, reducedMotion: false });
    expect(rotor.position.x).toBeCloseTo(-0.5, 9);
    expect(rotor.position.y).toBeCloseTo(0, 9);
    expect(rotor.position.length()).toBeCloseTo(0.5, 9);
  });

  it("freezes under reduced motion by default, or slows by a registered policy", () => {
    const frozen = fan().rotor;
    const freeze = bindPartAnimation(frozen, { animation: "spin", config: spin });
    freeze.update({ delta: 1, reducedMotion: true });
    expect(frozen.quaternion.equals(new THREE.Quaternion())).toBe(true);
    const slowed = fan().rotor;
    const slow = bindPartAnimation(slowed, {
      animation: "spin",
      config: { ...spin, reducedMotion: "slow" },
    });
    slow.update({ delta: 1, reducedMotion: true });
    // A quarter of a revolution in a second.
    expect(new THREE.Euler().setFromQuaternion(slowed.quaternion).z).toBeCloseTo(Math.PI / 2, 9);
  });

  it("stands still on a frame with no time (a covered scene's paused clock)", () => {
    const { rotor } = fan();
    const binding = bindPartAnimation(rotor, { animation: "spin", config: spin });
    binding.update({ delta: 0.1, reducedMotion: false });
    const held = rotor.quaternion.clone();
    binding.update({ delta: 0, reducedMotion: false });
    expect(rotor.quaternion.equals(held)).toBe(true);
  });

  it("puts the part back and unbinds exactly once; later frames do nothing", () => {
    const { rotor } = fan();
    const binding = bindPartAnimation(rotor, {
      animation: "spin",
      config: { ...spin, pivot: [0, 0, 0] },
    });
    binding.update({ delta: 0.3, reducedMotion: false });
    binding.dispose();
    expect(rotor.position.toArray()).toEqual([0, 0.5, 0]);
    expect(rotor.quaternion.equals(new THREE.Quaternion())).toBe(true);
    binding.dispose();
    binding.update({ delta: 0.3, reducedMotion: false });
    expect(rotor.quaternion.equals(new THREE.Quaternion())).toBe(true);
  });

  it("keeps two parts sharing one prepared geometry independent", () => {
    const geometry = new THREE.BoxGeometry();
    const a = new THREE.Mesh(geometry);
    const b = new THREE.Mesh(geometry);
    const one = bindPartAnimation(a, { animation: "spin", config: spin });
    bindPartAnimation(b, { animation: "spin", config: { ...spin, revolutionsPerSecond: 2 } });
    one.update({ delta: 0.125, reducedMotion: false });
    expect(b.quaternion.equals(new THREE.Quaternion())).toBe(true);
    expect(a.quaternion.equals(new THREE.Quaternion())).toBe(false);
  });

  it("refuses an unusable configuration where it is bound", () => {
    const { rotor } = fan();
    expect(() =>
      bindPartAnimation(rotor, { animation: "spin", config: { ...spin, axis: [0, 0, 0] } }),
    ).toThrow("axis");
    expect(() =>
      bindPartAnimation(rotor, {
        animation: "spin",
        config: { ...spin, revolutionsPerSecond: Number.NaN },
      }),
    ).toThrow("speed");
    expect(() =>
      bindPartAnimation(rotor, { animation: "spin", config: { ...spin, reducedMotion: "wobble" } }),
    ).toThrow();
    expect(() => bindPartAnimation(rotor, { animation: "twirl" })).toThrow();
    expect(partAnimations.has("spin")).toBe(true);
  });
});
