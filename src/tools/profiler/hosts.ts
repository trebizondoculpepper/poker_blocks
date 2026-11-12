/**
 * The profiler's registered hosts (#712): each lights the scene as one production path does and
 * gives reflective looks an environment made by the profiler's own renderer, never a texture
 * borrowed from another WebGL context.
 */
import type * as THREE from "three";
import { setReflectionEnvironment } from "../../visual/block-appearance";
import { boardLights, handLights } from "../../visual/lighting";
import { defaultProfilingHost, profilingHosts, type ProfilingHostSetup } from "./cases";

/** A host that adds a light rig and the renderer's own reflections, and takes the rig off after. */
function lit(rig: () => THREE.Light[]) {
  return ({ scene, reflections }: ProfilingHostSetup) => {
    const lights = rig();
    scene.add(...lights);
    // Blocks read the environment as they are built, so it is set before any is created.
    if (reflections) setReflectionEnvironment(reflections);
    return () => {
      for (const light of lights) light.removeFromParent();
    };
  };
}

if (!profilingHosts.has(defaultProfilingHost))
  profilingHosts.register(defaultProfilingHost, {
    label: "Board (card room lighting)",
    prepare: lit(boardLights),
  });
if (!profilingHosts.has("hand"))
  profilingHosts.register("hand", { label: "Hand (studio lighting)", prepare: lit(handLights) });
