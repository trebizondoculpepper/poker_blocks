import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import {
  bindRefractionInterior,
  createRefractionFront,
  createRefractionRear,
  refractionPresets,
} from "./crystal-refraction";

const tile = {
  screen: new THREE.Vector4(0.2, 0.3, 0.1, 0.2),
  atlas: new THREE.Vector4(0.001, 0.001, 0.123, 0.123),
};
const textures = { colour: new THREE.Texture(), depth: new THREE.DepthTexture(1, 1), target: null };

describe("a refractive front composes its own captured interior (#1228)", () => {
  it("has no interior until a mount binds one: the look is exactly as before", () => {
    const front = createRefractionFront(refractionPresets.get("calmWater"));
    expect(front.uniforms.interiorEnabled!.value).toBe(0);
    expect(front.uniforms.interiorColorMap!.value).toBeNull();
    // The interior resolves over the transmitted background, before the reflection mix.
    const shader = front.fragmentShader;
    expect(shader.indexOf("interiorAt(uv + shift)")).toBeGreaterThan(-1);
    expect(shader.indexOf("interiorAt(uv + shift)")).toBeLessThan(
      shader.indexOf("mix(seen, reflected"),
    );
    // It validates depth against the volume's ray interval and the opaque scene.
    expect(shader).toContain("depth > exitDepth");
    expect(shader).toContain("depth > occluder");
  });

  it("binds its own lease's tile and atlas each frame, and disables itself when there is none", () => {
    const front = createRefractionFront(refractionPresets.get("calmWater"));
    let current: typeof tile | null = tile;
    const binding = bindRefractionInterior(
      front,
      { textures: textures as never },
      { tile: () => current },
      new THREE.Vector3(0.5, 0.4, 0.3),
    );
    expect(binding.update()).toBe(true);
    const u = front.uniforms;
    expect(u.interiorEnabled!.value).toBe(1);
    expect(u.interiorColorMap!.value).toBe(textures.colour);
    expect(u.interiorDepthMap!.value).toBe(textures.depth);
    expect(u.interiorScreen!.value.toArray()).toEqual(tile.screen.toArray());
    expect(u.interiorAtlas!.value.toArray()).toEqual(tile.atlas.toArray());
    expect(u.interiorHalf!.value.toArray()).toEqual([0.5, 0.4, 0.3]);
    // Not drawn this frame (stale, released, off screen): no sampling of anything.
    current = null;
    expect(binding.update()).toBe(false);
    expect(u.interiorEnabled!.value).toBe(0);
    expect(u.interiorColorMap!.value).toBeNull();
  });

  it("disables itself when the capture holds no atlas, and stays disabled once released", () => {
    const front = createRefractionFront(refractionPresets.get("calmWater"));
    const none = bindRefractionInterior(
      front,
      { textures: null },
      { tile: () => tile },
      new THREE.Vector3(),
    );
    expect(none.update()).toBe(false);
    const binding = bindRefractionInterior(
      front,
      { textures: textures as never },
      { tile: () => tile },
      new THREE.Vector3(),
    );
    binding.update();
    binding.release();
    expect(front.uniforms.interiorEnabled!.value).toBe(0);
    expect(binding.update()).toBe(false);
  });

  it("keeps two fronts' bindings their own", () => {
    const preset = refractionPresets.get("calmWater");
    const a = createRefractionFront(preset);
    const b = createRefractionFront(preset);
    bindRefractionInterior(
      a,
      { textures: textures as never },
      { tile: () => tile },
      new THREE.Vector3(),
    ).update();
    expect(a.uniforms.interiorEnabled!.value).toBe(1);
    expect(b.uniforms.interiorEnabled!.value).toBe(0);
    // The rear pass is untouched by the interior.
    const rear = createRefractionRear(new THREE.BoxGeometry(), preset);
    expect((rear.material as THREE.ShaderMaterial).uniforms.interiorEnabled).toBeUndefined();
  });
});
