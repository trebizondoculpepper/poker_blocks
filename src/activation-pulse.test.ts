import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { createActivationPulse, pulseMilliseconds } from "./activation-pulse";
import { passiveActivation } from "./passive-rack";
import { categoryDefaults } from "./passive-categories";
import type { PassiveBlock } from "./passives";

const pulse = { id: "pulse", colour: "#ff0000" };

function mount() {
  const material = new THREE.MeshStandardMaterial({ emissive: 0x123456, emissiveIntensity: 0.2 });
  const object = new THREE.Object3D();
  object.scale.setScalar(2);
  return { object, materials: [material, material], material };
}

describe("activation pulse (#485)", () => {
  it("swells and glows from rest, then puts the object back exactly", () => {
    const target = mount();
    const p = createActivationPulse(target);
    p.start(pulse, 0);
    p.frame(pulseMilliseconds(pulse) / 2, false);
    expect(target.object.scale.x).toBeGreaterThan(2);
    expect(target.material.emissiveIntensity).toBeGreaterThan(0.5);
    p.frame(pulseMilliseconds(pulse), false);
    expect(p.running).toBe(false);
    expect(target.object.scale.x).toBe(2);
    expect(target.material.emissive.getHex()).toBe(0x123456);
    expect(target.material.emissiveIntensity).toBe(0.2);
  });

  it("restarts on a repeat without ratcheting the rest", () => {
    const target = mount();
    const p = createActivationPulse(target);
    p.start(pulse, 0);
    p.frame(200, false);
    p.start(pulse, 200);
    p.frame(200 + pulseMilliseconds(pulse) / 2, false);
    expect(target.object.scale.x).toBeLessThan(2 * 1.25);
    p.frame(200 + pulseMilliseconds(pulse), false);
    expect(target.object.scale.x).toBe(2);
    expect(target.material.emissiveIntensity).toBe(0.2);
  });

  it("takes a scale the host set mid-pulse as the new rest, and leaves it there", () => {
    const target = mount();
    const p = createActivationPulse(target);
    p.start(pulse, 0);
    p.frame(100, false);
    target.object.scale.setScalar(3); // an arrival tween, a spring
    p.frame(200, false);
    expect(target.object.scale.x).toBeGreaterThan(3);
    target.object.scale.setScalar(3);
    p.frame(pulseMilliseconds(pulse), false);
    expect(target.object.scale.x).toBe(3);
  });

  it("keeps the glow and drops the swell with reduced motion; stop puts it back at once", () => {
    const target = mount();
    const p = createActivationPulse(target);
    p.start(pulse, 0);
    p.frame(pulseMilliseconds(pulse) / 2, true);
    expect(target.object.scale.x).toBe(2);
    expect(target.material.emissiveIntensity).toBeGreaterThan(0.5);
    p.stop();
    expect(p.running).toBe(false);
    expect(target.material.emissiveIntensity).toBe(0.2);
  });

  it("a passive's look is its own when composed, else its category's", () => {
    const base = {
      id: "p",
      definitionId: "p",
      traits: {
        effectCategory: {},
        passive: { traitId: "p" },
        inspectable: { inspect: () => "p" },
      },
    } as unknown as PassiveBlock;
    expect(passiveActivation(base)).toBe(categoryDefaults(base.traits).activation);
    const own = {
      effect: { id: "echo", colour: "#00ff00" },
      sfx: "passive.activate.economy",
    } as const;
    const composed = { ...base, traits: { ...base.traits, activationPulse: own } };
    expect(passiveActivation(composed)).toBe(own);
  });
});
