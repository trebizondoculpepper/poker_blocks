import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { createHostTracker } from "./host-tracker";
import { defaultProfilingHost, profilingHosts } from "./cases";
import "./hosts";

describe("profiler hosts (#712, #720 review)", () => {
  it("lights the board host with every light the board shines on its blocks, lamp included", () => {
    const scene = new THREE.Scene();
    const undo = profilingHosts.get(defaultProfilingHost).prepare({ scene, reflections: null });
    const lights = scene.children.filter(
      (child): child is THREE.Light => (child as THREE.Light).isLight,
    );
    expect(lights.map((light) => light.type).sort()).toEqual([
      "DirectionalLight",
      "DirectionalLight",
      "HemisphereLight",
    ]);
    // The card room's overhead lamp: warm, and casting shadows as in play.
    const lamp = lights.find(
      (light) => light.color.getHex() === 0xfff1d6,
    ) as THREE.DirectionalLight;
    expect(lamp.castShadow).toBe(true);
    undo();
    expect(scene.children).toEqual([]);
  });

  it("undoes a still-building preview's host when a run starts, and never twice", () => {
    const tracker = createHostTracker();
    const undone: string[] = [];
    const building = tracker.track(() => undone.push("building"));
    const shown = tracker.track(() => undone.push("shown"));
    shown();
    expect(undone).toEqual(["shown"]);
    // A run starts while the first preview's factory is still building.
    tracker.releaseAll();
    expect(undone).toEqual(["shown", "building"]);
    // The preview resolves late and tidies up: nothing happens a second time.
    building();
    expect(undone).toEqual(["shown", "building"]);
    expect(tracker.size).toBe(0);
  });
});
