/**
 * Captured optical interiors (#1227; doc/optical-interiors.md, "Bounded capture proposal"): the
 * registration, resource and capture half. Particles inside an opaque-fronted optical volume (Calm
 * Water's front) can't be drawn into the main view, which the front hides, nor as an overlay, which
 * loses depth and isolation. Instead each displayed volume registers its explicit draw packet here,
 * and one capture per render context draws each registration alone into its own tile of one shared
 * colour/depth atlas, before the main render. The front then samples its own tile (#1228).
 *
 * - **Registration.** `register` takes an explicit packet (the live particles, leased: their
 *   geometry and world transform are read, never reparented or disposed), the volume they lie in,
 *   and a clipping capability made by a registered provider (`interiorClipping`). It answers a
 *   lease or an explicit `unavailable` diagnostic (capacity, disposed); never a silent overlay.
 *   The lease's release is idempotent and frees only what the capture made for it.
 * - **Handles.** A tile handle carries its slot's generation and the capture's context
 *   generation: a released or recycled slot, or a lost context, makes older handles stale, and
 *   `lookup` answers null for them, so a late appearance cannot sample another volume's tile.
 *   A tile is valid only once drawn by the latest `render`.
 * - **Resources.** No target exists until the first registration, and the targets go with the last
 *   release (zero allocation when unused). The atlas is allocated once for the effective capacity,
 *   never per frame: `tileSize` (64–256, default 128) per tile, at most `maxRegistrations` (64)
 *   tiles and `maxAtlasEdge` (2048) pixels per edge, bounded by the renderer's own texture limit.
 * - **Each frame,** per drawn registration: one scissored clear of its tile and one draw of its
 *   packet alone, through the host camera's own projection cropped to the volume's square screen
 *   bounds (a reduced-resolution image of the same projection, not another camera). Target,
 *   clear colour, layers, background and autoClear are put back, and the atlas's viewport and
 *   scissor reset, even if a draw throws; a draw that throws marks the capture unavailable.
 *
 * Conventions shared with the front (#1228):
 * - Colour is linear and premultiplied, alpha is coverage. Overlapping particles keep the nearest
 *   covered sample (depth test, no blending); invisible rim texels write neither colour nor depth.
 * - Depth is linear view depth (positive distance in front of the camera, in world units), read
 *   from either hardware depth (the atlas's or the background's) by `interiorDepthGlsl` with the
 *   camera's `cameraClip` (near, far, perspective 1 or orthographic 0).
 * - A tile's transform is its screen rectangle (min, size, in screen uv) and its atlas rectangle
 *   (offset, scale, in atlas uv, inset half a texel): `interiorTileGlsl` maps one to the other.
 */
import * as THREE from "three";
import { Registry } from "../core/registry";
import type { LiquidSurface } from "./contained";
import { preservingRenderState, type PassFrame } from "./render-pass";

/** A declared clipping capability: the volume a contribution may show in, in volume-local space. */
export type InteriorClipping = {
  /** The volume's local bounds: the tile covers their screen projection. */
  readonly bounds: THREE.Box3;
  /** Uniforms its GLSL reads. */
  readonly uniforms: Record<string, THREE.IUniform>;
  /**
   * GLSL defining `bool interiorInside(vec3 local, vec3 radius)`: whether a sprite of that
   * volume-local radius, centred at that volume-local point, lies wholly inside.
   */
  readonly glsl: string;
  /** Bring its uniforms up to date for this frame (a live liquid top, for instance). */
  update?(): void;
};

/** Makes a clipping capability from plain configuration (and live published capabilities). */
export type InteriorClippingProvider = { create(config: unknown): InteriorClipping };

/** Registered clipping providers: a volume declares one by name, never by its shape's name in code. */
export const interiorClipping = new Registry<InteriorClippingProvider>("interior clipping");

/** The convex cube (`convexCube`): its configuration. */
export type ConvexCubeConfig = {
  /** Half its edge, or its three half extents, in volume-local units. */
  halfSize: number | readonly [number, number, number];
  /** A live liquid top (contained.ts `LiquidSurface`): sprites must also lie below it. */
  surface?: LiquidSurface;
};

interiorClipping.register("convexCube", {
  create(raw) {
    const { halfSize, surface } = raw as ConvexCubeConfig;
    const extents = [halfSize].flat();
    const half = new THREE.Vector3(extents[0], extents[1] ?? extents[0], extents[2] ?? extents[0]);
    if ([half.x, half.y, half.z].some((each) => !(each > 0)))
      throw new RangeError(`convexCube halfSize must be positive: ${JSON.stringify(halfSize)}`);
    // xyz the surface's normal, w its height; a zero normal means no surface.
    const plane = new THREE.Vector4(0, 0, 0, 0);
    return {
      bounds: new THREE.Box3(half.clone().negate(), half.clone()),
      uniforms: { clipHalf: { value: half }, clipPlane: { value: plane } },
      glsl: /* glsl */ `
        uniform vec3 clipHalf;
        uniform vec4 clipPlane;
        bool interiorInside(vec3 p, vec3 radius) {
          if (any(greaterThan(abs(p) + radius, clipHalf))) return false;
          float reach = max(radius.x, max(radius.y, radius.z));
          return dot(clipPlane.xyz, clipPlane.xyz) == 0.0 || dot(p, clipPlane.xyz) + reach <= clipPlane.w;
        }
      `,
      update() {
        if (surface)
          plane.set(surface.normal.x, surface.normal.y, surface.normal.z, surface.height);
      },
    };
  },
});

/**
 * An explicit draw packet: live point particles, leased. The capture reads their geometry
 * (positions, and per-particle colour where the material uses it), world transform and sprite
 * (map, colour, opacity); `worldSize` is their size as `keepWorldSize` takes it.
 */
export type InteriorPointsPacket = {
  readonly source: THREE.Points;
  readonly worldSize: number;
};

/** One displayed volume's contribution. */
export type InteriorRegistration = {
  readonly packet: InteriorPointsPacket;
  /** The volume the particles lie in: its world transform is the clipping's local space. */
  readonly volume: THREE.Object3D;
  readonly clipping: InteriorClipping;
};

/**
 * A tile handle: valid only in the capture that issued it (`owner`, opaque), while its slot and
 * that capture's context keep these generations.
 */
export type InteriorTileHandle = {
  readonly owner: symbol;
  readonly slot: number;
  readonly generation: number;
  readonly context: number;
};

/** Where a tile lies: on screen (min, size in screen uv) and in the atlas (offset, scale). */
export type InteriorTileTransform = { screen: THREE.Vector4; atlas: THREE.Vector4 };

export type InteriorLease = {
  /** This registration's current handle (a new one after a context loss). */
  readonly handle: InteriorTileHandle;
  /** Its tile as the latest render drew it, or null (not drawn, released, lost). */
  tile(): InteriorTileTransform | null;
  /** Idempotent: frees this registration's own capture material and its slot. */
  release(): void;
};

/** An explicit refusal: nothing is registered, drawn or overlaid. */
export type InteriorUnavailable = { readonly unavailable: string };

export type InteriorCaptureOptions = {
  /** Pixels per tile edge, 64–256 (default 128). */
  tileSize?: number;
  /** Simultaneous registrations at most (default 64). */
  maxRegistrations?: number;
  /** Atlas pixels per edge at most (default 2048). */
  maxAtlasEdge?: number;
  /** The renderer's own limit (`renderer.capabilities.maxTextureSize`). */
  maxTextureSize?: number;
  /** Where development diagnostics go (default: the console's warning). */
  diagnose?: (message: string) => void;
};

/** What the capture holds and did in its latest render: costs reported, not claimed. */
export type InteriorCaptureStats = {
  registrations: number;
  capacity: number;
  tileSize: number;
  /** Atlas pixels per edge while allocated, else 0. */
  atlasEdge: number;
  /** Render targets held now (0 or 1, with its depth attachment). */
  targets: number;
  /** Bytes the atlas's colour (half float RGBA) and depth (32-bit) hold, estimated. */
  bytes: number;
  /** In the latest render: tile clears and tile draws. */
  clears: number;
  draws: number;
  /** Why the capture is unavailable, if it is. */
  unavailable: string | null;
};

/** The renderer methods the capture uses besides a pass's. */
export type InteriorRenderer = PassFrame["renderer"] & { autoClear: boolean };

export type InteriorFrame = Omit<PassFrame, "renderer"> & { renderer: InteriorRenderer };

/** Sets `into` to the camera's near, far and whether it is a perspective one (1) or not (0). */
export function setCameraClip(into: THREE.Vector3, camera: THREE.Camera): THREE.Vector3 {
  const { near = 0.1, far = 100 } = camera as THREE.Camera & { near?: number; far?: number };
  return into.set(near, far, camera.projectionMatrix.elements[11] !== 0 ? 1 : 0);
}

/** GLSL: linear view depth from hardware depth, for either projection (see the module notes). */
export const interiorDepthGlsl = /* glsl */ `
  float interiorViewDepth(float hardware, vec3 clip) {
    if (clip.z > 0.5) {
      float ndc = hardware * 2.0 - 1.0;
      return 2.0 * clip.x * clip.y / (clip.y + clip.x - ndc * (clip.y - clip.x));
    }
    return clip.x + hardware * (clip.y - clip.x);
  }
`;

/** GLSL: a screen uv's place in a tile, and whether it lies inside the tile's screen rectangle. */
export const interiorTileGlsl = /* glsl */ `
  bool interiorInTile(vec2 screenUv, vec4 screen) {
    vec2 t = (screenUv - screen.xy) / screen.zw;
    return all(greaterThanEqual(t, vec2(0.0))) && all(lessThanEqual(t, vec2(1.0)));
  }
  vec2 interiorTileUv(vec2 screenUv, vec4 screen, vec4 atlas) {
    return atlas.xy + clamp((screenUv - screen.xy) / screen.zw, 0.0, 1.0) * atlas.zw;
  }
`;

/** The same linear view depth, on the CPU: for tests and diagnostics. */
export function interiorViewDepth(hardware: number, clip: THREE.Vector3): number {
  if (clip.z > 0.5) {
    const ndc = hardware * 2 - 1;
    return (2 * clip.x * clip.y) / (clip.y + clip.x - ndc * (clip.y - clip.x));
  }
  return clip.x + hardware * (clip.y - clip.x);
}

const proxyVertex = (clipping: string) => /* glsl */ `
  uniform mat4 toVolume;
  uniform vec3 radius;
  uniform float worldSize;
  uniform float pointScale;
  uniform float attenuate;
  uniform float orthoScale;
  varying vec3 vColour;
  ${clipping}
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 local = (toVolume * vec4(position, 1.0)).xyz;
    // The declared volume clips the whole sprite, not only its centre.
    if (!interiorInside(local, radius)) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    gl_Position = projectionMatrix * mv;
    // The main render's pixel size, scaled into the tile (as keepWorldSize sizes it there).
    gl_PointSize = (attenuate > 0.5 ? worldSize / -mv.z : worldSize * orthoScale) * pointScale;
    #ifdef USE_COLOR
      vColour = color;
    #else
      vColour = vec3(1.0);
    #endif
  }
`;

const proxyFragment = /* glsl */ `
  uniform sampler2D map;
  uniform float hasMap;
  uniform vec3 diffuse;
  uniform float opacity;
  varying vec3 vColour;
  void main() {
    vec4 texel = hasMap > 0.5 ? texture2D(map, vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y)) : vec4(1.0);
    vec3 colour = diffuse * texel.rgb * vColour;
    float coverage = texel.a * opacity;
    // A resting (black) particle and the rim's invisible texels write neither colour nor depth.
    if (coverage < 0.01 || dot(colour, vec3(1.0)) < 0.01) discard;
    gl_FragColor = vec4(colour * coverage, coverage);
  }
`;

type Slot = {
  generation: number;
  registration: InteriorRegistration | null;
  proxy: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null;
  drawn: number;
  screen: THREE.Vector4;
  atlas: THREE.Vector4;
};

const corner = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchVolumeScale = new THREE.Vector3();
const size = new THREE.Vector2();
const viewProjection = new THREE.Matrix4();
const crop = new THREE.Matrix4();

/**
 * Where the volume's bounds fall on screen, as a square in drawing-buffer pixels (so square
 * sprites stay square in the tile): min and size in screen uv, or null when wholly off screen.
 * Bounds reaching behind the camera take the whole screen.
 */
export function interiorScreenRect(
  bounds: THREE.Box3,
  volume: THREE.Matrix4,
  camera: THREE.Camera,
  width: number,
  height: number,
  into = new THREE.Vector4(),
): THREE.Vector4 | null {
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let behind = false;
  for (let index = 0; index < 8; index++) {
    corner
      .set(
        index & 1 ? bounds.max.x : bounds.min.x,
        index & 2 ? bounds.max.y : bounds.min.y,
        index & 4 ? bounds.max.z : bounds.min.z,
      )
      .applyMatrix4(volume);
    const e = viewProjection.elements;
    const w = e[3]! * corner.x + e[7]! * corner.y + e[11]! * corner.z + e[15]!;
    if (w <= 1e-6) {
      behind = true;
      break;
    }
    corner.applyMatrix4(viewProjection);
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
  }
  if (behind) [minX, minY, maxX, maxY] = [-1, -1, 1, 1];
  if (maxX < -1 || minX > 1 || maxY < -1 || minY > 1) return null;
  // To drawing-buffer pixels, squared about the centre.
  const centreX = ((minX + maxX) / 4 + 0.5) * width;
  const centreY = ((minY + maxY) / 4 + 0.5) * height;
  const side = Math.max(1, ((maxX - minX) / 2) * width, ((maxY - minY) / 2) * height);
  return into.set(
    (centreX - side / 2) / width,
    (centreY - side / 2) / height,
    side / width,
    side / height,
  );
}

/** The capture for one render context (a renderer, scene and camera). */
export function createInteriorCapture(options: InteriorCaptureOptions = {}) {
  const tileSize = options.tileSize ?? 128;
  if (!(tileSize >= 64 && tileSize <= 256))
    throw new RangeError(`interior tile size must be 64–256 pixels: ${tileSize}`);
  const edgeLimit = Math.min(options.maxAtlasEdge ?? 2048, options.maxTextureSize ?? Infinity);
  const perEdge = Math.floor(edgeLimit / tileSize);
  const capacity = Math.max(0, Math.min(options.maxRegistrations ?? 64, perEdge * perEdge));
  const side = Math.min(perEdge, Math.ceil(Math.sqrt(capacity)));
  const edge = side * tileSize;
  const diagnose = options.diagnose ?? ((message: string) => console.warn(message));

  const slots: Slot[] = Array.from({ length: capacity }, () => ({
    generation: 0,
    registration: null,
    proxy: null,
    drawn: -1,
    screen: new THREE.Vector4(),
    atlas: new THREE.Vector4(),
  }));
  let atlas: THREE.WebGLRenderTarget | null = null;
  let context = 0;
  let frames = 0;
  let clears = 0;
  let draws = 0;
  let unavailable: string | null = capacity ? null : "no interior tile fits this renderer";
  let disposed = false;
  const camera = new THREE.Camera();
  camera.matrixWorldAutoUpdate = false;

  const registered = () => slots.filter((slot) => slot.registration).length;

  const freeTargets = () => {
    atlas?.depthTexture?.dispose();
    atlas?.dispose();
    atlas = null;
  };

  const allocate = () => {
    atlas ??= new THREE.WebGLRenderTarget(edge, edge, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(edge, edge),
    });
  };

  // This capture's own token: another capture's handle, or an older capture's, is never its own.
  const owner = Symbol("interior capture");

  const handleOf = (index: number, generation: number): InteriorTileHandle => ({
    owner,
    slot: index,
    generation,
    context,
  });

  const lookup = (handle: InteriorTileHandle): InteriorTileTransform | null => {
    const slot = slots[handle.slot];
    if (
      handle.owner !== owner ||
      !slot?.registration ||
      unavailable ||
      handle.context !== context ||
      handle.generation !== slot.generation ||
      slot.drawn !== frames
    )
      return null;
    return { screen: slot.screen, atlas: slot.atlas };
  };

  const makeProxy = ({ packet, clipping }: InteriorRegistration) => {
    const live = packet.source.material as THREE.PointsMaterial;
    const material = new THREE.ShaderMaterial({
      vertexShader: proxyVertex(clipping.glsl),
      fragmentShader: proxyFragment,
      uniforms: {
        ...clipping.uniforms,
        toVolume: { value: new THREE.Matrix4() },
        radius: { value: new THREE.Vector3() },
        worldSize: { value: packet.worldSize },
        pointScale: { value: 1 },
        attenuate: { value: 1 },
        orthoScale: { value: 1 },
        map: { value: null },
        hasMap: { value: 0 },
        diffuse: { value: new THREE.Color() },
        opacity: { value: 1 },
      },
      vertexColors: live.vertexColors,
      depthTest: true,
      depthWrite: true,
      blending: THREE.NoBlending,
    });
    // The live geometry, leased: shared, never disposed with the proxy.
    const proxy = new THREE.Points(packet.source.geometry, material);
    proxy.matrixAutoUpdate = false;
    proxy.matrixWorldAutoUpdate = false;
    proxy.frustumCulled = false;
    return proxy;
  };

  const shown = (object: THREE.Object3D | null): boolean => {
    for (let each = object; each; each = each.parent) if (!each.visible) return false;
    return true;
  };

  const drawTile = (
    renderer: InteriorRenderer,
    host: THREE.Camera,
    index: number,
    width: number,
    height: number,
  ) => {
    const slot = slots[index]!;
    const { packet, volume, clipping } = slot.registration!;
    const proxy = slot.proxy!;
    const source = packet.source;
    if (!shown(source)) return;
    // This frame's placement, whether or not the host has drawn its scene yet.
    volume.updateWorldMatrix(true, false);
    source.updateWorldMatrix(true, false);
    const rect = interiorScreenRect(
      clipping.bounds,
      volume.matrixWorld,
      host,
      width,
      height,
      slot.screen,
    );
    if (!rect) return;
    // The host projection, cropped to the rectangle: the same image, at the tile's resolution.
    const [x, y, w, h] = [rect.x * 2 - 1, rect.y * 2 - 1, rect.z * 2, rect.w * 2];
    crop.set(2 / w, 0, 0, -(2 * x + w) / w, 0, 2 / h, 0, -(2 * y + h) / h, 0, 0, 1, 0, 0, 0, 0, 1);
    camera.projectionMatrix.multiplyMatrices(crop, host.projectionMatrix);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.matrixWorld.copy(host.matrixWorld);
    camera.matrixWorldInverse.copy(host.matrixWorldInverse);
    // The packet's live state, read for this draw.
    clipping.update?.();
    const live = source.material as THREE.PointsMaterial;
    const uniforms = proxy.material.uniforms;
    proxy.matrixWorld.copy(source.matrixWorld);
    uniforms.toVolume!.value.copy(volume.matrixWorld).invert().multiply(source.matrixWorld);
    const world = packet.worldSize * source.getWorldScale(scratchScale).y;
    const projection = host.projectionMatrix.elements;
    const perspective = projection[11] !== 0;
    // The sprite's actual world extent as drawn: three.js attenuates a perspective point by depth
    // alone, so its world size is `world / P[5]` there; an orthographic one is `world` exactly.
    const extent = perspective ? world / projection[5]! : world;
    const volumeScale = volume.getWorldScale(scratchVolumeScale);
    uniforms.radius!.value.set(
      extent / 2 / volumeScale.x,
      extent / 2 / volumeScale.y,
      extent / 2 / volumeScale.z,
    );
    uniforms.worldSize!.value = world;
    uniforms.attenuate!.value = perspective ? 1 : 0;
    uniforms.orthoScale!.value = projection[5]!;
    uniforms.pointScale!.value = tileSize / (2 * rect.w);
    uniforms.map!.value = live.map;
    uniforms.hasMap!.value = live.map ? 1 : 0;
    uniforms.diffuse!.value.copy(live.color);
    uniforms.opacity!.value = live.opacity;
    // Its tile: viewport and scissor are the atlas's own, applied by setting it as the target.
    const column = index % side;
    const row = Math.floor(index / side);
    atlas!.viewport.set(column * tileSize, row * tileSize, tileSize, tileSize);
    atlas!.scissor.copy(atlas!.viewport);
    atlas!.scissorTest = true;
    renderer.setRenderTarget(atlas);
    renderer.clear();
    clears++;
    renderer.render(proxy, camera);
    draws++;
    // Half a texel in, so filtering never reads a neighbouring tile.
    const texel = 0.5 / edge;
    slot.atlas.set(
      (column * tileSize) / edge + texel,
      (row * tileSize) / edge + texel,
      tileSize / edge - 2 * texel,
      tileSize / edge - 2 * texel,
    );
    slot.drawn = frames;
  };

  return {
    /** Register one displayed volume's contribution: a lease, or why not. */
    register(registration: InteriorRegistration): InteriorLease | InteriorUnavailable {
      if (disposed) return { unavailable: "the interior capture is disposed" };
      if (unavailable) return { unavailable };
      const index = slots.findIndex((slot) => !slot.registration);
      if (index < 0) {
        const message = `interior capture is full: ${capacity} registrations at ${tileSize}px`;
        diagnose(message);
        return { unavailable: message };
      }
      const slot = slots[index]!;
      slot.generation++;
      slot.registration = registration;
      slot.proxy = makeProxy(registration);
      slot.drawn = -1;
      allocate();
      const generation = slot.generation;
      let held = true;
      return {
        get handle() {
          // Its own registration's generation: after release it stays stale, whoever reuses the slot.
          return handleOf(index, generation);
        },
        tile: () => (held ? lookup(handleOf(index, generation)) : null),
        release() {
          if (!held) return;
          held = false;
          if (slot.generation !== generation) return;
          slot.proxy?.material.dispose();
          slot.proxy = null;
          slot.registration = null;
          slot.generation++;
          if (!registered()) freeTargets();
        },
      };
    },

    /** Draw every shown registration's tile, before the main render samples them. */
    render(next: InteriorFrame): void {
      frames++;
      clears = 0;
      draws = 0;
      if (unavailable || !atlas) return;
      const { renderer } = next;
      next.camera.updateMatrixWorld();
      renderer.getDrawingBufferSize(size);
      const width = Math.max(1, Math.floor(size.x));
      const height = Math.max(1, Math.floor(size.y));
      const autoClear = renderer.autoClear;
      preservingRenderState(next, () => {
        renderer.autoClear = false;
        renderer.setClearColor(0x000000, 0);
        try {
          slots.forEach((slot, index) => {
            if (slot.registration) drawTile(renderer, next.camera, index, width, height);
          });
        } catch (error) {
          unavailable = `interior capture failed: ${error instanceof Error ? error.message : "unknown"}`;
          diagnose(unavailable);
          freeTargets();
        } finally {
          renderer.autoClear = autoClear;
          if (atlas) {
            atlas.viewport.set(0, 0, edge, edge);
            atlas.scissor.set(0, 0, edge, edge);
            atlas.scissorTest = false;
          }
        }
      });
    },

    /** A tile as the latest render drew it, or null for a stale or undrawn handle. */
    lookup,

    /**
     * The renderer's context was lost: every handle so far is stale and the targets are freed.
     * Registrations stay; their leases' new handles are drawn again by the next render.
     */
    contextLost(): void {
      context++;
      // Nothing drawn before the loss survives it.
      for (const slot of slots) slot.drawn = -1;
      freeTargets();
      if (registered() && !unavailable) allocate();
    },

    /**
     * The atlas, its colour and its depth, for the front to sample (null while nothing is
     * registered). The target is for read-back by tools; nothing else draws into it.
     */
    get textures(): {
      target: THREE.WebGLRenderTarget;
      colour: THREE.Texture;
      depth: THREE.Texture | null;
    } | null {
      return atlas ? { target: atlas, colour: atlas.texture, depth: atlas.depthTexture } : null;
    },

    stats(): InteriorCaptureStats {
      return {
        registrations: registered(),
        capacity,
        tileSize,
        atlasEdge: atlas ? edge : 0,
        targets: atlas ? 1 : 0,
        bytes: atlas ? edge * edge * (8 + 4) : 0,
        clears,
        draws,
        unavailable,
      };
    },

    /** Free every registration's capture material and the targets. */
    dispose(): void {
      disposed = true;
      for (const slot of slots) {
        slot.proxy?.material.dispose();
        slot.proxy = null;
        slot.registration = null;
        slot.generation++;
      }
      freeTargets();
    },
  };
}

export type InteriorCapture = ReturnType<typeof createInteriorCapture>;
