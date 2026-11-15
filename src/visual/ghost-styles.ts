/**
 * Drag-ghost appearance endpoints (#1083; doc/drag-ghost-audition.md, "Appearance endpoints").
 * A registry of styles, each building a gesture-owned endpoint visual from an explicit appearance
 * description. A style knows nothing of timing or transitions (#1084) and no material identity:
 * it reads only what the appearance declares.
 *
 * **Part bindings.** `BlockAppearance` declares its parts explicitly, and the styles bind to them
 * by role, never by shader class or material name:
 * - `materials` (and `boardMaterials`) are the block's face surfaces, one per geometry group;
 * - `extras` are the non-face model components (a contained block, a crystal's fire);
 * - `edgeColor`/`edgeOpacity` are the declared outline;
 * - `prepasses` are the passes those parts need before the host's main render.
 *
 * **Ownership.** An endpoint owns what it creates and disposes exactly that, once. It may share
 * the appearance's geometry, extras' geometries and materials by reference (they belong to the
 * source block), but never mutates or disposes them.
 */
import * as THREE from "three";
import { Registry } from "../core/registry";
import type { PrepassReference } from "./appearance-prepass";
import type { BlockAppearance } from "./block-appearance";
import { createLaserOutline, defaultLaserOutline, type LaserOutlineConfig } from "./laser-outline";

/** What a style builds an endpoint from: the carried block's appearance and its edge length. */
export type GhostSource = { appearance: BlockAppearance; size: number };

/** One carried block's endpoint visual, owned by the gesture that built it. */
export type GhostEndpoint = {
  /** Mount it at the carried block's transform. */
  object: THREE.Object3D;
  /** Passes the endpoint needs while shown; the host acquires and releases them with it. */
  prepasses: readonly PrepassReference[];
  /** Advance any animation (the laser's haze) on the presentation clock. */
  update(seconds: number, reducedMotion?: boolean): void;
  /** Release what the endpoint created. Safe to call more than once. */
  dispose(): void;
};

/** A registered style: its configuration comes from whoever composes it. */
export type GhostStyle = { create(source: GhostSource, config: unknown): GhostEndpoint };

export const ghostStyles = new Registry<GhostStyle>("ghost style");

const once = (release: () => void) => {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    release();
  };
};

export type WireframeConfig = { colour?: number; opacity?: number };

/** The carried model's own geometry edges, with no filled faces. */
export const wireframeStyle: GhostStyle = {
  create({ appearance }, config) {
    const { colour = appearance.edgeColor, opacity = 1 } = (config ?? {}) as WireframeConfig;
    const edges = new THREE.EdgesGeometry(appearance.geometry);
    const material = new THREE.LineBasicMaterial({
      color: colour,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    const object = new THREE.LineSegments(edges, material);
    return {
      object,
      prepasses: [],
      update() {},
      dispose: once(() => {
        edges.dispose();
        material.dispose();
      }),
    };
  },
};

/**
 * The original model with its face surfaces suppressed: its declared extras (shared by
 * reference) and its declared outline, with no face materials drawn.
 */
export const faceFreeStyle: GhostStyle = {
  create({ appearance }) {
    const object = new THREE.Group();
    const edges = new THREE.EdgesGeometry(appearance.geometry);
    const outline = new THREE.LineBasicMaterial({
      color: appearance.edgeColor,
      transparent: true,
      opacity: appearance.edgeOpacity,
      depthWrite: false,
    });
    object.add(new THREE.LineSegments(edges, outline));
    // A clone shares the extra's geometry and material (the source block owns them) and keeps
    // its declared render lifecycle, so an animated extra still animates (#1176).
    for (const extra of appearance.extras ?? []) object.add(cloneWithRenderLifecycle(extra));
    return {
      object,
      prepasses: appearance.prepasses ?? [],
      update() {},
      dispose: once(() => {
        edges.dispose();
        outline.dispose();
        object.clear();
      }),
    };
  },
};

/**
 * A recursive clone of `source` that keeps each object's own render hooks. three.js copies
 * transforms, children and references but not `onBeforeRender`/`onAfterRender`, which is where
 * contained shells, fire cores and world-sized points update their per-object state.
 */
export function cloneWithRenderLifecycle<T extends THREE.Object3D>(source: T): T {
  const clone = source.clone(true) as T;
  const pairs: [THREE.Object3D, THREE.Object3D][] = [];
  const walk = (from: THREE.Object3D, to: THREE.Object3D) => {
    pairs.push([from, to]);
    from.children.forEach((child, index) => walk(child, to.children[index]));
  };
  walk(source, clone);
  for (const [from, to] of pairs) {
    // three.js calls each hook on the object being rendered, so the clone is `this`.
    // oxlint-disable-next-line typescript/unbound-method -- deliberately carrying the hook
    to.onBeforeRender = from.onBeforeRender;
    // oxlint-disable-next-line typescript/unbound-method -- deliberately carrying the hook
    to.onAfterRender = from.onAfterRender;
  }
  return clone;
}

export type LaserCubeConfig = {
  /** The shared laser preset's colour. */
  colour: number;
  /** Beam width relative to the first-play outline's; clamped to a sane range. */
  widthScale?: number;
  laser?: Partial<LaserOutlineConfig>;
};

/** Beam widths a laser cube may scale to, relative to the first-play outline. */
export const laserWidthScaleRange = { min: 0.25, max: 4 } as const;

/**
 * A plain cube at the carried block's bounds, outlined by the actual laser outline the
 * first-play ghost uses (src/visual/laser-outline.ts), with slightly thicker beams.
 */
export const laserCubeStyle: GhostStyle = {
  create({ size }, config) {
    const { colour, widthScale = 1.25, laser = {} } = config as LaserCubeConfig;
    const scale = Math.min(
      laserWidthScaleRange.max,
      Math.max(laserWidthScaleRange.min, widthScale),
    );
    const base = { ...laser };
    const box = new THREE.BoxGeometry(size, size, size);
    const outline = createLaserOutline(box, colour, size, {
      ...base,
      coreRadius: (base.coreRadius ?? defaultLaserOutline.coreRadius) * scale,
      glowRadius: (base.glowRadius ?? defaultLaserOutline.glowRadius) * scale,
    });
    return {
      object: outline.object,
      prepasses: [],
      update: (seconds, reducedMotion) => outline.update(seconds, reducedMotion),
      dispose: once(() => {
        outline.dispose();
        box.dispose();
      }),
    };
  },
};

ghostStyles.register("wireframe", wireframeStyle);
ghostStyles.register("faceFree", faceFreeStyle);
ghostStyles.register("laserCube", laserCubeStyle);
