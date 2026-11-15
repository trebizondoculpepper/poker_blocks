import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { passRenderer } from "../tools/profiler/fake-pass-renderer";
import { createInteriorBoundary, type LiquidSurface } from "./contained";
import {
  createRefractionCapture,
  createRefractionFront,
  refractionPresets,
} from "./crystal-refraction";
import { fluidLooks } from "./filled-vessel";
import {
  createInteriorCapture,
  interiorClipping,
  interiorScreenRect,
  interiorViewDepth,
  setCameraClip,
  type InteriorFrame,
  type InteriorLease,
  type InteriorRegistration,
  type InteriorUnavailable,
} from "./optical-interior";
import { risingBubbles } from "./rising-bubbles";

type Draw = {
  object: THREE.Object3D;
  target: THREE.WebGLRenderTarget | null;
  viewport: THREE.Vector4 | null;
  projection: THREE.Matrix4;
};

/** A renderer that remembers each draw and clear, and the tile each went to. */
function recording(fail = false) {
  const base = passRenderer();
  const draws: Draw[] = [];
  const clears: (THREE.Vector4 | null)[] = [];
  const renderer = {
    ...base,
    autoClear: true,
    render(object: THREE.Object3D, camera: THREE.Camera) {
      if (fail) throw new Error("context lost");
      const target = base.getRenderTarget();
      draws.push({
        object,
        target,
        viewport: target?.scissorTest ? target.viewport.clone() : null,
        projection: camera.projectionMatrix.clone(),
      });
    },
    clear() {
      const target = base.getRenderTarget();
      clears.push(target?.scissorTest ? target.scissor.clone() : null);
    },
  };
  return { renderer, draws, clears };
}

function host(renderer: InteriorFrame["renderer"]): InteriorFrame {
  const camera = new THREE.PerspectiveCamera(50, 320 / 180, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.updateMatrixWorld();
  return {
    renderer,
    scene: new THREE.Scene(),
    camera,
    hide: new THREE.Group(),
    delta: 0,
    reducedMotion: false,
  };
}

/** A volume at `x` holding a few points, with its contribution. */
function volume(x = 0, colour = 0xffffff): InteriorRegistration & { group: THREE.Group } {
  const group = new THREE.Group();
  group.position.x = x;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0.1, 0.1, 0]), 3),
  );
  const source = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: colour, size: 0.05 }),
  );
  group.add(source);
  group.updateMatrixWorld();
  return {
    group,
    volume: group,
    packet: { source, worldSize: 0.05 },
    clipping: interiorClipping.get("convexCube").create({ halfSize: 0.5 }),
  };
}

const leased = (result: InteriorLease | InteriorUnavailable): InteriorLease => {
  if ("unavailable" in result) throw new Error(result.unavailable);
  return result;
};

describe("optical interior capture: resources (#1227)", () => {
  it("allocates nothing until a registration, and frees its targets with the last release", () => {
    const capture = createInteriorCapture();
    const { renderer, draws } = recording();
    capture.render(host(renderer));
    expect(capture.stats()).toMatchObject({ targets: 0, bytes: 0, draws: 0, clears: 0 });
    expect(capture.textures).toBeNull();
    expect(draws).toHaveLength(0);
    const a = leased(capture.register(volume()));
    const b = leased(capture.register(volume(1)));
    // One atlas, allocated once for the whole capacity: 64 tiles of 128 px make 8 × 8, 1024 px.
    expect(capture.stats()).toMatchObject({
      targets: 1,
      atlasEdge: 1024,
      capacity: 64,
      registrations: 2,
    });
    expect(capture.stats().bytes).toBe(1024 * 1024 * 12);
    const { colour, depth } = capture.textures!;
    a.release();
    a.release();
    expect(capture.stats()).toMatchObject({ targets: 1, registrations: 1 });
    b.release();
    expect(capture.stats()).toMatchObject({ targets: 0, bytes: 0, registrations: 0 });
    expect(capture.textures).toBeNull();
    expect(colour).not.toBe(depth);
  });

  it("bounds its capacity by registrations, atlas edge and the renderer's texture limit", () => {
    expect(createInteriorCapture({ maxRegistrations: 2 }).stats().capacity).toBe(2);
    expect(createInteriorCapture({ tileSize: 256 }).stats().capacity).toBe(64);
    expect(createInteriorCapture({ tileSize: 256, maxTextureSize: 1024 }).stats().capacity).toBe(
      16,
    );
    expect(() => createInteriorCapture({ tileSize: 32 })).toThrow(RangeError);
    expect(() => createInteriorCapture({ tileSize: 512 })).toThrow(RangeError);
    const none = createInteriorCapture({ tileSize: 256, maxTextureSize: 128 });
    expect(none.register(volume())).toEqual({ unavailable: "no interior tile fits this renderer" });
  });

  it("refuses a registration beyond capacity with a diagnostic, never an overlay", () => {
    const diagnose = vi.fn();
    const capture = createInteriorCapture({ maxRegistrations: 1, diagnose });
    leased(capture.register(volume()));
    const refused = capture.register(volume(1));
    expect(refused).toEqual({ unavailable: expect.stringContaining("full") });
    expect(diagnose).toHaveBeenCalledOnce();
    const { renderer, draws } = recording();
    capture.render(host(renderer));
    expect(draws).toHaveLength(1);
  });

  it("disposes only the capture's own materials, never the leased geometry or particles", () => {
    const capture = createInteriorCapture();
    const each = volume();
    const geometry = vi.fn();
    const live = vi.fn();
    each.packet.source.geometry.addEventListener("dispose", geometry);
    (each.packet.source.material as THREE.Material).addEventListener("dispose", live);
    const lease = leased(capture.register(each));
    const { renderer, draws } = recording();
    capture.render(host(renderer));
    const proxy = draws[0]!.object as THREE.Points<THREE.BufferGeometry, THREE.Material>;
    expect(proxy).not.toBe(each.packet.source);
    expect(proxy.geometry).toBe(each.packet.source.geometry);
    const own = vi.fn();
    proxy.material.addEventListener("dispose", own);
    lease.release();
    expect(own).toHaveBeenCalledOnce();
    expect(geometry).not.toHaveBeenCalled();
    expect(live).not.toHaveBeenCalled();
    expect(each.packet.source.parent).toBe(each.group);
  });
});

describe("optical interior capture: drawing (#1227)", () => {
  it("draws each shown registration alone into its own tile, with one scissored clear", () => {
    const capture = createInteriorCapture();
    const { renderer, draws, clears } = recording();
    const a = leased(capture.register(volume(-1)));
    const b = leased(capture.register(volume(1)));
    const frame = host(renderer);
    capture.render(frame);
    expect(capture.stats()).toMatchObject({ draws: 2, clears: 2 });
    // Only the packets, never the scene.
    expect(draws.map((each) => each.object)).not.toContain(frame.scene);
    expect(draws.map((each) => each.viewport!.toArray())).toEqual([
      [0, 0, 128, 128],
      [128, 0, 128, 128],
    ]);
    expect(clears.map((each) => each!.toArray())).toEqual([
      [0, 0, 128, 128],
      [128, 0, 128, 128],
    ]);
    // Each looks up its own tile; the atlas rectangles don't overlap.
    const tileA = a.tile()!;
    const tileB = b.tile()!;
    expect(tileA.atlas.x + tileA.atlas.z).toBeLessThan(tileB.atlas.x);
    expect(tileA.screen.x).toBeLessThan(tileB.screen.x);
  });

  it("puts back the target, clear colour, autoClear, layers and background, and resets the atlas", () => {
    const capture = createInteriorCapture();
    const { renderer } = recording();
    renderer.setClearColor(0x336699, 0.75);
    leased(capture.register(volume()));
    const frame = host(renderer);
    frame.scene.background = new THREE.Color(0x111111);
    const background = frame.scene.background;
    frame.camera.layers.set(3);
    capture.render(frame);
    expect(renderer.getRenderTarget()).toBeNull();
    expect(renderer.getClearColor(new THREE.Color()).getHex()).toBe(0x336699);
    expect(renderer.getClearAlpha()).toBe(0.75);
    expect(renderer.autoClear).toBe(true);
    expect(frame.camera.layers.mask).toBe(1 << 3);
    expect(frame.scene.background).toBe(background);
  });

  it("skips a hidden packet or an off-screen volume: no draw, and no tile to sample", () => {
    const capture = createInteriorCapture();
    const { renderer, draws } = recording();
    const hidden = volume();
    hidden.group.visible = false;
    const away = volume(100);
    const a = leased(capture.register(hidden));
    const b = leased(capture.register(away));
    capture.render(host(renderer));
    expect(draws).toHaveLength(0);
    expect(a.tile()).toBeNull();
    expect(b.tile()).toBeNull();
  });

  it("crops the host projection to the volume's square screen bounds: the same image, smaller", () => {
    const capture = createInteriorCapture();
    const { renderer, draws } = recording();
    const each = volume(0.6);
    const lease = leased(capture.register(each));
    const frame = host(renderer);
    capture.render(frame);
    const { screen } = lease.tile()!;
    // Square in drawing-buffer pixels (320 × 180).
    expect(screen.z * 320).toBeCloseTo(screen.w * 180);
    const cropped = new THREE.Camera();
    cropped.projectionMatrix.copy(draws[0]!.projection);
    cropped.matrixWorldInverse.copy(frame.camera.matrixWorldInverse);
    // Any point projects to the same screen place through both: tile uv maps back to screen uv.
    for (const point of [
      new THREE.Vector3(0.6, 0, 0),
      new THREE.Vector3(0.9, 0.3, 0.4),
      new THREE.Vector3(0.3, -0.4, -0.5),
    ]) {
      const onScreen = point.clone().project(frame.camera);
      const inTile = point.clone().project(cropped);
      const screenUv = new THREE.Vector2(onScreen.x / 2 + 0.5, onScreen.y / 2 + 0.5);
      const tileUv = new THREE.Vector2(inTile.x / 2 + 0.5, inTile.y / 2 + 0.5);
      expect(screen.x + tileUv.x * screen.z).toBeCloseTo(screenUv.x, 6);
      expect(screen.y + tileUv.y * screen.w).toBeCloseTo(screenUv.y, 6);
      // Depth is untouched by the crop.
      expect(inTile.z).toBeCloseTo(onScreen.z, 6);
    }
    // Every bound corner lands inside the tile.
    for (const x of [-0.5, 0.5])
      for (const y of [-0.5, 0.5])
        for (const z of [-0.5, 0.5]) {
          const p = new THREE.Vector3(0.6 + x, y, z).project(cropped);
          expect(Math.abs(p.x)).toBeLessThanOrEqual(1 + 1e-6);
          expect(Math.abs(p.y)).toBeLessThanOrEqual(1 + 1e-6);
        }
  });

  it("takes the whole screen for bounds reaching behind the camera", () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.updateMatrixWorld();
    const bounds = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    const rect = interiorScreenRect(bounds, new THREE.Matrix4(), camera, 200, 100)!;
    // Square in pixels about the centre: 200 px wide, so it overreaches vertically.
    expect(rect.toArray()).toEqual([0, -0.5, 1, 2]);
  });

  it("an unavailable capture after a failed draw frees its targets and samples nothing", () => {
    const diagnose = vi.fn();
    const capture = createInteriorCapture({ diagnose });
    const lease = leased(capture.register(volume()));
    const { renderer } = recording(true);
    renderer.setClearColor(0x123456, 1);
    capture.render(host(renderer));
    expect(diagnose).toHaveBeenCalledWith(expect.stringContaining("context lost"));
    expect(capture.stats()).toMatchObject({ targets: 0, unavailable: expect.any(String) });
    expect(lease.tile()).toBeNull();
    expect(renderer.getRenderTarget()).toBeNull();
    expect(renderer.getClearColor(new THREE.Color()).getHex()).toBe(0x123456);
    expect(renderer.autoClear).toBe(true);
    expect(capture.register(volume())).toEqual({ unavailable: expect.any(String) });
  });
});

describe("optical interior capture: handles (#1227)", () => {
  it("a tile is valid only once drawn by the latest render", () => {
    const capture = createInteriorCapture();
    const { renderer } = recording();
    const frame = host(renderer);
    const lease = leased(capture.register(volume()));
    expect(lease.tile()).toBeNull();
    capture.render(frame);
    expect(lease.tile()).not.toBeNull();
    const held = lease.handle;
    expect(capture.lookup(held)).not.toBeNull();
  });

  it("a recycled slot never answers an older handle", () => {
    const capture = createInteriorCapture({ maxRegistrations: 1 });
    const { renderer } = recording();
    const frame = host(renderer);
    const first = leased(capture.register(volume()));
    capture.render(frame);
    const old = first.handle;
    first.release();
    expect(first.tile()).toBeNull();
    const second = leased(capture.register(volume(0.5)));
    capture.render(frame);
    expect(second.handle.slot).toBe(old.slot);
    expect(capture.lookup(old)).toBeNull();
    expect(second.tile()).not.toBeNull();
    // The first's late release leaves the second's registration alone.
    first.release();
    expect(second.tile()).not.toBeNull();
  });

  it("a lost context makes every handle so far stale; leases are drawn again under new ones", () => {
    const capture = createInteriorCapture();
    const { renderer } = recording();
    const frame = host(renderer);
    const lease = leased(capture.register(volume()));
    capture.render(frame);
    const before = lease.handle;
    const { colour } = capture.textures!;
    capture.contextLost();
    expect(capture.lookup(before)).toBeNull();
    expect(lease.tile()).toBeNull();
    expect(capture.textures!.colour).not.toBe(colour);
    capture.render(frame);
    expect(lease.handle.context).toBe(before.context + 1);
    expect(lease.tile()).not.toBeNull();
    expect(capture.lookup(before)).toBeNull();
  });

  it("two hosts drawing the same particles keep their own targets and tiles", () => {
    const shared = volume();
    const one = createInteriorCapture();
    const two = createInteriorCapture();
    const a = recording();
    const b = recording();
    const leaseOne = leased(one.register(shared));
    const leaseTwo = leased(two.register(shared));
    one.render(host(a.renderer));
    two.render(host(b.renderer));
    expect(a.draws[0]!.target).not.toBe(b.draws[0]!.target);
    expect(a.draws[0]!.object).not.toBe(b.draws[0]!.object);
    expect(one.textures!.colour).not.toBe(two.textures!.colour);
    leaseOne.release();
    expect(leaseTwo.tile()).not.toBeNull();
    two.dispose();
    expect(leaseTwo.tile()).toBeNull();
  });
});

describe("optical interior conventions (#1227)", () => {
  it("reads linear view depth from hardware depth for either projection", () => {
    const perspective = new THREE.PerspectiveCamera(50, 1, 0.5, 40);
    const clip = setCameraClip(new THREE.Vector3(), perspective);
    expect(clip.toArray()).toEqual([0.5, 40, 1]);
    for (const distance of [0.5, 2, 13, 40]) {
      const ndc = new THREE.Vector3(0, 0, -distance).applyMatrix4(perspective.projectionMatrix).z;
      expect(interiorViewDepth(ndc / 2 + 0.5, clip)).toBeCloseTo(distance, 4);
    }
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 11);
    const orthoClip = setCameraClip(new THREE.Vector3(), ortho);
    expect(orthoClip.z).toBe(0);
    const ndc = new THREE.Vector3(0, 0, -6).applyMatrix4(ortho.projectionMatrix).z;
    expect(interiorViewDepth(ndc / 2 + 0.5, orthoClip)).toBeCloseTo(6, 6);
  });

  it("a convex cube clips to its bounds and follows a live liquid top", () => {
    const surface: LiquidSurface = {
      normal: new THREE.Vector3(0, 1, 0),
      height: 0.1,
      wet: () => true,
    };
    const cube = interiorClipping.get("convexCube").create({ halfSize: [0.5, 0.4, 0.3], surface });
    expect(cube.bounds.max.toArray()).toEqual([0.5, 0.4, 0.3]);
    expect(cube.uniforms.clipPlane!.value.toArray()).toEqual([0, 0, 0, 0]);
    cube.update!();
    expect(cube.uniforms.clipPlane!.value.toArray()).toEqual([0, 1, 0, 0.1]);
    expect(cube.glsl).toContain("bool interiorInside(vec3 p, vec3 radius)");
    expect(() => interiorClipping.get("convexCube").create({ halfSize: 0 })).toThrow(RangeError);
  });

  it("the background capture keeps its depth as a sampled attachment, with the camera's clip", () => {
    const front = createRefractionFront(refractionPresets.get("calmWater"));
    const capture = createRefractionCapture("calmWater");
    const { renderer, draws } = recording();
    const frame = host(renderer);
    capture.render(frame);
    // Still two renders (background, rear offsets): no extra depth pass.
    expect(draws).toHaveLength(2);
    const background = draws[0]!.target!;
    expect(background.depthTexture).toBeInstanceOf(THREE.DepthTexture);
    expect(front.uniforms.backgroundDepthMap!.value).toBe(background.depthTexture);
    expect(front.uniforms.cameraClip!.value.toArray()).toEqual([0.1, 100, 1]);
    capture.dispose();
    expect(front.uniforms.backgroundDepthMap!.value).toBeNull();
    front.dispose();
  });
});

describe("interior contributions return their release (#1227)", () => {
  it("the transmission capture puts back everything it changed, once", () => {
    const look = fluidLooks.get("refractiveFluid")({} as never, {
      tint: 0xffffff,
      ior: 1.33,
      thickness: 1,
      roughness: 0,
      attenuation: 0xffffff,
      attenuationDistance: 1,
    });
    const material = new THREE.PointsMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(new THREE.BufferGeometry(), material);
    points.renderOrder = 7;
    const release = look.interior!.include(points);
    expect(material.transparent).toBe(false);
    expect(material.alphaTest).toBe(0.15);
    release();
    expect(material).toMatchObject({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      alphaTest: 0,
    });
    expect(points.renderOrder).toBe(7);
    expect(Object.hasOwn(material, "onBeforeCompile")).toBe(false);
    material.transparent = false;
    release();
    expect(material.transparent).toBe(false);
  });

  it("rising bubbles release their registration when the block disposes them", () => {
    const release = vi.fn();
    const surface: LiquidSurface = {
      normal: new THREE.Vector3(0, 1, 0),
      height: 0,
      wet: () => true,
    };
    const boundary = createInteriorBoundary(new THREE.BoxGeometry(1, 1, 1), 1, 0.92);
    const bubbles = risingBubbles.build(
      boundary,
      {
        liquidSurface: surface,
        volume: {
          bounds: new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(),
            new THREE.Vector3(0.9, 0.9, 0.9),
          ),
          rise: surface.normal,
          surface,
        },
        interior: { include: () => release },
      },
      { count: 4, rise: 0.3, wobble: 0, size: 0.07, rest: 0.2, colour: 0xffffff, opacity: 0.7 },
    );
    expect(release).not.toHaveBeenCalled();
    ((bubbles.meshes[0] as THREE.Points).material as THREE.Material).dispose();
    expect(release).toHaveBeenCalledOnce();
  });
});

describe("optical interior capture: review findings (#1289)", () => {
  it("places a tile by this frame's transforms, even before the host has updated them", () => {
    const capture = createInteriorCapture();
    const { renderer, draws } = recording();
    const each = volume(0);
    const lease = leased(capture.register(each));
    const frame = host(renderer);
    capture.render(frame);
    const before = lease.tile()!.screen.clone();
    // Moved, with no matrix update: the capture must still see it where it is now.
    each.group.position.x = 1;
    capture.render(frame);
    const after = lease.tile()!.screen;
    expect(after.x).toBeGreaterThan(before.x);
    expect(draws[1]!.object.matrixWorld.elements[12]).toBeCloseTo(1);
  });

  it("a released lease's handle never answers for the slot's next registration", () => {
    const capture = createInteriorCapture({ maxRegistrations: 1 });
    const { renderer } = recording();
    const frame = host(renderer);
    const first = leased(capture.register(volume()));
    first.release();
    leased(capture.register(volume(0.5)));
    capture.render(frame);
    expect(capture.lookup(first.handle)).toBeNull();
  });

  it("a handle is only ever valid in the capture that issued it", () => {
    const one = createInteriorCapture();
    const two = createInteriorCapture();
    const a = recording();
    const b = recording();
    const leaseOne = leased(one.register(volume()));
    const leaseTwo = leased(two.register(volume()));
    one.render(host(a.renderer));
    two.render(host(b.renderer));
    expect(leaseOne.handle).toMatchObject({ slot: 0, generation: leaseTwo.handle.generation });
    expect(one.lookup(leaseTwo.handle)).toBeNull();
    expect(two.lookup(leaseOne.handle)).toBeNull();
    expect(one.lookup(leaseOne.handle)).not.toBeNull();
  });

  it("clips by the sprite's drawn world size, for either projection", () => {
    const capture = createInteriorCapture({ maxRegistrations: 2 });
    const { renderer, draws } = recording();
    leased(capture.register(volume()));
    const frame = host(renderer);
    capture.render(frame);
    const radius = (draws[0]!.object as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>)
      .material.uniforms.radius!.value as THREE.Vector3;
    // Perspective: three.js draws `worldSize / -z` pixels per half screen, so `0.05 / P[5]` wide.
    expect(radius.x).toBeCloseTo(0.05 / 2 / frame.camera.projectionMatrix.elements[5]!, 9);
    const ortho = new THREE.OrthographicCamera(-2, 2, 1, -1, 0.1, 100);
    ortho.position.set(0, 0, 5);
    capture.render({ ...frame, camera: ortho });
    const orthoRadius = (
      draws[1]!.object as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
    ).material.uniforms.radius!.value as THREE.Vector3;
    expect(orthoRadius.x).toBeCloseTo(0.05 / 2, 9);
  });

  it("clips a turned volume by the square sprite's reach along its own axes", () => {
    const capture = createInteriorCapture();
    const { renderer, draws } = recording();
    const each = volume();
    each.group.rotation.z = Math.PI / 4;
    each.group.updateMatrixWorld(true);
    (each.packet as { worldSize: number }).worldSize = 0.2;
    leased(capture.register(each));
    const ortho = new THREE.OrthographicCamera(-2, 2, 1, -1, 0.1, 100);
    ortho.position.set(0, 0, 5);
    capture.render({ ...host(renderer), camera: ortho });
    const radius = (draws[0]!.object as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>)
      .material.uniforms.radius!.value as THREE.Vector3;
    // The square's half-width 0.1 along screen x and y, seen 45° turned: 0.1 × (cos + sin).
    expect(radius.x).toBeCloseTo(0.1 * Math.SQRT2, 9);
    expect(radius.y).toBeCloseTo(0.1 * Math.SQRT2, 9);
    // A sprite at local x 0.39 would reach 0.531: past the 0.5 wall, so it is clipped.
    expect(0.39 + radius.x).toBeGreaterThan(0.5);
  });
});
