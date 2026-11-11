/**
 * A hollow, clear vessel part-filled with a viscous fluid (#227): a lightweight visual
 * approximation, not a fluid simulation. Since #330 it is two contained components
 * (src/visual/contained.ts): the `plasticShell` container and the `vesselFluid` contents,
 * configured by a material's `appearance.container` and `appearance.contents` data, so any
 * material can be a filled vessel, or an empty one, without a branch on its name.
 *
 * - **Shell:** a clear plastic outer skin plus a slightly smaller inner skin drawn from the back,
 *   so the walls show their thickness.
 * - **Fluid:** a copy of the block's shape, smaller again, cut by a flat surface. Fragments
 *   above the surface are discarded; the back faces seen through the cut are shaded flat, so
 *   the cut reads as the fluid's top. The surface's normal eases toward "up" (in the block's
 *   own space) with a time constant of `settleSeconds`, so when the block turns the fluid
 *   levels slowly, with no splash or overshoot.
 * - **Wall trace:** a second, slower-easing surface marks where the fluid was. Inner wall that
 *   is below that old surface but above the current one is tinted faintly; as the old surface
 *   catches up (`traceSeconds`), the tinted band shrinks to nothing, so the trace fades.
 *
 * The surface's height is an approximation: `level` 0.5 puts it through the middle, and other
 * levels move it along its normal in proportion. Exact volume is not kept as the block tilts.
 */
import * as THREE from "three";
import { Registry } from "../core/registry";
import { additiveSheen } from "./additive-light";
import {
  containedContents,
  containedLayers,
  containedResidues,
  containerShells,
  type ContentsHandler,
  type ResidueHandler,
  type ShellHandler,
} from "./contained";
import type { Simulation } from "./shared-simulation";

/** The plastic shell (#227, extracted in #330): clear skins and an optional gloss. */
export type PlasticShellConfig = {
  /** The shell's opacity: low for clear plastic. */
  opacity: number;
  /** The inner skin's scale, relative to the outer: the wall's thickness. */
  inset: number;
  /**
   * The strength of a gloss layer over the shell: its reflections at full strength, however
   * clear the shell is (a transparent material's own reflections are scaled down by its low
   * opacity, so clear plastic alone looks dull). Leave it out for no gloss layer.
   */
  gloss?: number;
};

/**
 * A levelling fluid (#227, #332, #333): how full it is and how slowly it settles, and how it
 * looks, a registered look (`fluidLooks`) with its own configuration. Its mechanics never
 * depend on its look.
 */
export type LevellingFluidConfig = {
  /** How full the vessel is, from 0 (empty) to 1 (full). */
  level: number;
  /** Time constant, in seconds, of the fluid levelling after the block turns. */
  settleSeconds: number;
  /** Its optics: a registered look and its configuration. */
  look: { id: string; config: unknown };
};

/** The uniforms every look cuts the fluid with: its surface, in the fluid mesh's own units. */
export type FluidSurfaceUniforms = {
  surfaceNormal: { value: THREE.Vector3 };
  height: { value: number };
};

/**
 * How a fluid looks (#333), keyed by name: a material for the fluid volume that discards
 * everything above the shared surface. The look never moves the surface.
 */
export type FluidLook = (
  surface: FluidSurfaceUniforms,
  config: unknown,
) => { material: THREE.Material; layer: "contentsOpaque" | "contentsTransparent" };
export const fluidLooks = new Registry<FluidLook>("fluid look");

/** Custard's look (#227): flat-shaded colour and a lighter, flat top seen through the cut. */
fluidLooks.register("opaqueFluid", (surface, raw) => {
  const { fill, surface: top } = raw as { fill: number; surface: number };
  return {
    material: new THREE.ShaderMaterial({
      uniforms: {
        ...surface,
        fill: { value: new THREE.Color(fill) },
        surfaceColour: { value: new THREE.Color(top) },
      },
      vertexShader: fluidVertex,
      fragmentShader: fluidFragment,
      side: THREE.DoubleSide,
    }),
    layer: "contentsOpaque",
  };
});

/**
 * Clear, refracting fluid (#333): a physical material with transmission and an index of
 * refraction, cut at the same surface by a discard injected into its shader (so it needs no
 * renderer clipping). It refracts what is opaque behind it, as three.js transmission does
 * (#346: it does not refract other glass or fluid).
 */
fluidLooks.register("refractiveFluid", (surface, raw) => {
  const config = raw as {
    tint: number;
    ior: number;
    thickness: number;
    roughness: number;
    attenuation: number;
    attenuationDistance: number;
  };
  const material = new THREE.MeshPhysicalMaterial({
    color: config.tint,
    metalness: 0,
    roughness: config.roughness,
    transmission: 1,
    ior: config.ior,
    thickness: config.thickness,
    attenuationColor: new THREE.Color(config.attenuation),
    attenuationDistance: config.attenuationDistance,
    // Both sides, as the opaque look does: seen from above through the cut, the inner (back)
    // faces fill the opening and read as the water's top, rather than an open hole.
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, surface);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFluidLocal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFluidLocal = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vFluidLocal;\nuniform vec3 surfaceNormal;\nuniform float height;",
      )
      .replace(
        "#include <clipping_planes_fragment>",
        "#include <clipping_planes_fragment>\nif (dot(vFluidLocal, surfaceNormal) > height) discard;",
      );
  };
  return { material, layer: "contentsTransparent" };
});

/** The wall trace (#227): where the fluid was, fading as its own lagging plane catches up. */
export type WallTraceConfig = {
  /** Its colour (hex): the fluid's, usually. */
  fill: number;
  /** Time constant, in seconds, of the trace fading. */
  seconds: number;
  /** Its opacity where it is freshest. */
  opacity: number;
};

const fluidVertex = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormal;
  void main() {
    vLocal = position;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fluidFragment = /* glsl */ `
  uniform vec3 surfaceNormal;
  uniform float height;
  uniform vec3 fill;
  uniform vec3 surfaceColour;
  varying vec3 vLocal;
  varying vec3 vNormal;
  void main() {
    if (dot(vLocal, surfaceNormal) > height) discard;
    if (!gl_FrontFacing) {
      // Seen through the cut: the fluid's flat top.
      gl_FragColor = vec4(surfaceColour, 1.0);
      return;
    }
    // A soft, creamy shade: wrapped diffuse from a fixed key light in view space.
    float light = 0.55 + 0.45 * max(dot(normalize(vNormal), normalize(vec3(0.3, 0.8, 0.5))), 0.0);
    gl_FragColor = vec4(fill * light, 1.0);
  }
`;

const traceFragment = /* glsl */ `
  uniform vec3 surfaceNormal;
  uniform vec3 traceNormal;
  uniform float height;
  uniform vec3 fill;
  uniform float opacity;
  varying vec3 vLocal;
  void main() {
    float now = dot(vLocal, surfaceNormal) - height;
    float before = dot(vLocal, traceNormal) - height;
    // Wet: under where the fluid was, above where it is now.
    if (before > 0.0 || now <= 0.0) discard;
    // Fades toward the old line and with how far the two surfaces still differ.
    float spread = 1.0 - dot(surfaceNormal, traceNormal);
    float strength = clamp(spread * 12.0, 0.0, 1.0) * smoothstep(0.0, 0.08, -before);
    gl_FragColor = vec4(fill, opacity * strength);
  }
`;

/** The plastic shell: a clear outer skin, an inner skin drawn from the back, and a gloss. */
export const plasticShell: ShellHandler = ({ geometry, environment }, raw) => {
  const config = raw as PlasticShellConfig;
  const plastic = (side: THREE.Side) =>
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMap: environment,
      envMapIntensity: 1.1,
      transparent: true,
      opacity: config.opacity,
      depthWrite: false,
      side,
    });
  const inner = new THREE.Mesh(geometry, plastic(THREE.BackSide));
  inner.scale.setScalar(config.inset);
  inner.renderOrder = containedLayers.shellBack;
  // Additive and black-based, so it only adds reflected light and never hides the contents;
  // drawn last, over everything inside. Marked `reflective`, so a renderer with its own
  // environment (the block title) points it there as it does the block's faces.
  const glosses = [config.gloss ?? []].flat().map((intensity) => {
    const gloss = new THREE.Mesh(
      geometry,
      new THREE.MeshPhysicalMaterial({
        color: 0x000000,
        metalness: 0,
        roughness: 0.05,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        envMap: environment,
        envMapIntensity: intensity,
        transparent: true,
        ...additiveSheen,
        depthWrite: false,
      }),
    );
    gloss.material.userData.reflective = true;
    gloss.scale.setScalar(1.002);
    gloss.renderOrder = containedLayers.gloss;
    return gloss;
  });
  return { faces: plastic(THREE.FrontSide), meshes: [inner, ...glosses], inset: config.inset };
};

/**
 * A levelling fluid (#332): it fills the boundary's volume, cut by a surface that eases toward
 * world "up" as its block turns, and publishes that surface (`liquidSurface`) for anything on
 * the wall to sample. Each fluid keeps its own surface, so independently moving vessels level
 * by their own motion (#329, sharing decision in doc/game-architecture.md).
 */
export const levellingFluid: ContentsHandler = (boundary, raw) => {
  const config = raw as LevellingFluidConfig;
  const normal = new THREE.Vector3(0, 1, 0);
  // In the fluid's own (unscaled) space: half the block is `halfSize`.
  const height = (config.level - 0.5) * boundary.halfSize * 2;
  const look = fluidLooks.get(config.look.id)(
    { surfaceNormal: { value: normal }, height: { value: height } },
    config.look.config,
  );
  const fluid = boundary.volume(look.material, look.layer);
  const settle = createSettler({ settleSeconds: config.settleSeconds, traceSeconds: 1 });
  const unused = new THREE.Vector3();
  return {
    meshes: [fluid],
    // Driven by the block's one frame (src/visual/contained.ts), never its own clock.
    update: ({ rotation, seconds }) => settle(rotation, seconds, normal, unused),
    capabilities: {
      // Published in block-local space: the shader's height is in the volume mesh's own
      // (scaled) units, so it is scaled out here.
      liquidSurface: {
        normal,
        height: height * boundary.volumeScale,
        wet: (point) => point.dot(normal) <= height * boundary.volumeScale,
      },
    },
  };
};

/**
 * The wall trace as residue (#332, an adapter for the old trace until #334's richer residue):
 * it keeps its own plane, easing toward the published surface with `seconds`, and tints the
 * wall between the two. The fluid never knows it is there.
 */
export const wallTrace: ResidueHandler = {
  requires: "liquidSurface",
  build(boundary, { liquidSurface }, raw) {
    const config = raw as WallTraceConfig;
    const surface = liquidSurface!;
    const lagging = new THREE.Vector3(0, 1, 0);
    const uniforms = {
      surfaceNormal: { value: surface.normal },
      traceNormal: { value: lagging },
      // The published height is block-local; the wall mesh's own units are scaled by wallScale.
      height: { value: surface.height / boundary.wallScale },
      fill: { value: new THREE.Color(config.fill) },
      opacity: { value: config.opacity },
    };
    const trace = boundary.wall(
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: fluidVertex,
        fragmentShader: traceFragment,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
      }),
      "residue",
    );
    return {
      meshes: [trace],
      // After the contents in the block's one frame: on the first frame the trace starts at the
      // published surface (no false wet band on a vessel first seen tilted), then lags it.
      update: ({ first, delta }) => {
        if (first) lagging.copy(surface.normal);
        else lagging.lerp(surface.normal, 1 - Math.exp(-delta / config.seconds)).normalize();
      },
    };
  },
};

containerShells.register("plasticShell", plasticShell);
containedContents.register("levellingFluid", levellingFluid);
containedResidues.register("wallTrace", wallTrace);

/**
 * Eases the fluid's surface (and, more slowly, its trace) toward level, given the block's world
 * rotation. Pure apart from the vectors it updates, so it can be tested without rendering.
 */
export function createSettler(config: {
  settleSeconds: number;
  traceSeconds: number;
}): (
  rotation: THREE.Quaternion,
  now: number,
  surface: THREE.Vector3,
  trace: THREE.Vector3,
) => void {
  let last: number | null = null;
  const up = new THREE.Vector3();
  const inverse = new THREE.Quaternion();
  return (rotation, now, surface, trace) => {
    // "Up" in the block's own space: world up, turned back by the block's rotation.
    up.set(0, 1, 0).applyQuaternion(inverse.copy(rotation).invert());
    if (last === null) {
      // The first frame starts level, with no trace.
      surface.copy(up);
      trace.copy(up);
    } else {
      const delta = Math.min(now - last, 0.1);
      surface.lerp(up, 1 - Math.exp(-delta / config.settleSeconds)).normalize();
      trace.lerp(surface, 1 - Math.exp(-delta / config.traceSeconds)).normalize();
    }
    last = now;
  };
}

/**
 * The shared fluid simulation for one vessel configuration (#230). It steps once per frame,
 * driven by the first block rendered that frame (blocks on the table all share the structure's
 * rotation). Its state is world-space normals, which any block turns into its own space; when
 * the driving block turns, the fluid turns with it before levelling, and when a different block
 * takes over driving, nothing jumps.
 */
export type VesselSimulation = Simulation<{ rotation: THREE.Quaternion; driver: object }> & {
  /** This frame's surface and trace normals, in the space of a block with rotation `own`. */
  localNormals(own: THREE.Quaternion, surface: THREE.Vector3, trace: THREE.Vector3): void;
};

export function createVesselSimulation(config: {
  settleSeconds: number;
  traceSeconds: number;
}): VesselSimulation {
  // The state is kept in world space, so it never depends on which block drives it.
  const surfaceWorld = new THREE.Vector3(0, 1, 0);
  const traceWorld = new THREE.Vector3(0, 1, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const previous = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  const inverse = new THREE.Quaternion();
  let last: { now: number; driver: object } | null = null;
  return {
    step(now, { rotation, driver }) {
      if (last) {
        // The same block turned since the last frame: the fluid turns with its container
        // before it levels again. A different driving block carries nothing, so the shared
        // result never jumps when the block that drives it changes.
        if (last.driver === driver) {
          turn.copy(rotation).multiply(inverse.copy(previous).invert());
          surfaceWorld.applyQuaternion(turn);
          traceWorld.applyQuaternion(turn);
        }
        const delta = Math.min(now - last.now, 0.1);
        surfaceWorld.lerp(up, 1 - Math.exp(-delta / config.settleSeconds)).normalize();
        traceWorld.lerp(surfaceWorld, 1 - Math.exp(-delta / config.traceSeconds)).normalize();
      }
      previous.copy(rotation);
      last = { now, driver };
    },
    localNormals(own, surface, trace) {
      inverse.copy(own).invert();
      surface.copy(surfaceWorld).applyQuaternion(inverse);
      trace.copy(traceWorld).applyQuaternion(inverse);
    },
  };
}
