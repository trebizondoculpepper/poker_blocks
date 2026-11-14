/**
 * Dazzle (#493): being dazzled by a bright discharge, a reusable presentation trait-free effect.
 * Adapted from Encabulator's `createDazzle` (src/toolkit/components/core/logic/dazzle.ts and
 * views/dazzle.ts, the owner's own project): its look and timing, rewritten for this project's
 * configuration, lifecycle and sound registry. Its synthesised click is not copied: a flash plays
 * a configured registered sound (the live `block.dazzle_pop`, #519) through `playSfx`.
 *
 * - A **flash** at a world point whites the view out round where it is seen for a frame or two,
 *   with `minCircles` to `circles` circles of light blooming out there (`popPattern`, never the
 *   same twice), white at the centre shading to a configured fringe (`colours`). A flash may
 *   override any of this for itself (#510: an explosion's three to six white-and-yellow pops).
 * - Each circle leaves a dark, faintly purple **afterimage** fixed to the screen (it is on the
 *   eye: it doesn't move as the camera does), fading over about seven seconds (`ghostSeconds`).
 * - It draws on a DOM layer over the canvas that never takes input (`pointer-events: none`).
 * - **Bounded:** at most `maxGhosts` afterimages at once; the oldest goes first.
 * - **Reduced motion and flash safety:** the glare is capped (`glare.max`), and under reduced
 *   motion it is only a soft brightening (`glare.reduced`) with dimmer circles.
 * - It decides nothing; cosmetic randomness only (the given `random`, never the run's stream).
 */
import * as THREE from "three";
import type { SoundEffectId } from "../audio/sfx-registry";
import { playSfx } from "../audio/sfx";

export type DazzleConfig = {
  /** Frames the glare lasts. */
  flashFrames: number;
  /** How long an afterimage lasts: normally distributed, never under `min` (seconds). */
  ghost: { mean: number; sd: number; min: number };
  /**
   * At least `minCircles` and at most `circles` circles a pop, strewn up to `spread` (shares of
   * the screen's height).
   */
  minCircles?: number;
  circles: number;
  spread: number;
  /** The glare's peak opacity, and its opacity under reduced motion. */
  glare: { max: number; reduced: number };
  /** A circle's colours: its centre, and the fringe it shades to (CSS colours). */
  colours: { centre: string; fringe: string };
  /** At most this many afterimages on screen at once. */
  maxGhosts: number;
  /** The registered sound a flash plays, once; none when omitted. */
  sound?: SoundEffectId;
};

export const defaultDazzle: DazzleConfig = {
  flashFrames: 2,
  ghost: { mean: 7, sd: 2, min: 1.5 },
  circles: 4,
  spread: 0.09,
  glare: { max: 0.8, reduced: 0.25 },
  colours: { centre: "#ffffff", fringe: "rgb(236, 244, 255)" },
  maxGhosts: 24,
  sound: "block.dazzle_pop",
};

/** What one flash may override: its pop's circles, colours, glare and sound. */
export type DazzleLook = Pick<
  DazzleConfig,
  "minCircles" | "circles" | "spread" | "colours" | "glare" | "sound"
>;

/** Seconds an afterimage lasts, from two uniform random numbers (normal, floored). */
export function ghostSeconds(
  ghost: DazzleConfig["ghost"],
  random: () => number = Math.random,
): number {
  const u = Math.max(random(), 1e-9);
  const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  return Math.max(ghost.min, ghost.mean + ghost.sd * normal);
}

/** How dark an afterimage is, out of one, `age` seconds in: darkest at once, gone at `seconds`. */
export function ghostLevel(age: number, seconds: number): number {
  if (age <= 0) return 1;
  if (age >= seconds) return 0;
  const k = age / seconds;
  return (1 - k) * (1 - k * k);
}

/** One of a pop's circles: offset and radius as shares of the screen's height. */
export type PopCircle = { dx: number; dy: number; radius: number; frames: number };

/**
 * A pop's circles: `minCircles` (default one) to `circles`, the first on the discharge and the
 * rest strewn round it,
 * smaller further out, each blooming out in one to three frames. `strength` (0 to 1) sizes them.
 */
export function popPattern(
  config: Pick<DazzleConfig, "minCircles" | "circles" | "spread">,
  strength = 1,
  random: () => number = Math.random,
): PopCircle[] {
  const least = Math.max(1, Math.min(config.minCircles ?? 1, config.circles));
  const choices = config.circles - least + 1;
  const count = least + Math.min(choices - 1, Math.floor(random() * choices));
  const scale = 0.6 + 0.4 * Math.max(0, Math.min(1, strength));
  return Array.from({ length: count }, (_, i) => {
    const angle = random() * Math.PI * 2;
    const out = i === 0 ? 0 : config.spread * (0.35 + 0.65 * random());
    return {
      dx: out && Math.cos(angle) * out,
      dy: out && Math.sin(angle) * out,
      radius: scale * (i === 0 ? 0.08 + 0.05 * random() : 0.03 + 0.06 * random()),
      frames: 1 + Math.min(2, Math.floor(random() * 3)),
    };
  });
}

/** How far out a circle has bloomed, out of one, `frame` frames in: quick at first. */
export function bloom(frame: number, frames: number): number {
  const k = Math.max(0, Math.min(1, frame / frames));
  return 1 - (1 - k) * (1 - k);
}

/** Whether a projected point is within the camera's depth range and near the screen. */
export const inView = (projected: THREE.Vector3): boolean =>
  projected.z >= -1 &&
  projected.z <= 1 &&
  Math.abs(projected.x) <= 1.2 &&
  Math.abs(projected.y) <= 1.2;

/** A dazzle drawn over `host` (which should cover the canvas), seen through `camera`. */
export function createDazzle(
  host: HTMLElement,
  camera: THREE.Camera,
  options: {
    config?: Partial<DazzleConfig>;
    random?: () => number;
    reducedMotion?: () => boolean;
  } = {},
) {
  const config = { ...defaultDazzle, ...options.config };
  const random = options.random ?? Math.random;
  const reducedMotion = options.reducedMotion ?? (() => false);
  const layer = document.createElement("div");
  Object.assign(layer.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    overflow: "hidden",
  });
  host.append(layer);
  const glare = document.createElement("div");
  Object.assign(glare.style, {
    position: "absolute",
    inset: "0",
    opacity: "0",
    mixBlendMode: "screen",
  });
  layer.append(glare);
  type Bloom = {
    element: HTMLDivElement;
    x: number;
    y: number;
    radius: number;
    frame: number;
    frames: number;
  };
  type Ghost = { element: HTMLDivElement; age: number; seconds: number };
  const blooms: Bloom[] = [];
  const ghosts: Ghost[] = [];
  let glareFrames = 0;
  const seen = new THREE.Vector3();

  const ghost = (x: number, y: number, radius: number) => {
    while (ghosts.length >= config.maxGhosts) ghosts.shift()!.element.remove();
    const element = document.createElement("div");
    const ry = radius * (0.8 + 0.2 * random());
    Object.assign(element.style, {
      position: "absolute",
      left: `${x}%`,
      top: `${y}%`,
      width: `${2 * radius}vh`,
      height: `${2 * ry}vh`,
      transform: `translate(-50%, -50%) rotate(${random() * 180}deg)`,
      borderRadius: "50%",
      background:
        "radial-gradient(closest-side, rgba(14, 6, 24, 0.95), rgba(34, 14, 48, 0.75) 45%, rgba(40, 30, 10, 0.25) 75%, rgba(0, 0, 0, 0) 100%)",
      mixBlendMode: "multiply",
      filter: "blur(0.6vh)",
    });
    layer.append(element);
    ghosts.push({ element, age: 0, seconds: ghostSeconds(config.ghost, random) });
  };

  return {
    /**
     * A discharge at a world point: it pops, and dazzles where it is seen, if in view. `look`
     * overrides this dazzle's pop for this flash only (its circles, colours, glare or sound).
     */
    flash(
      at: THREE.Vector3,
      { strength = 1, look = {} }: { strength?: number; look?: Partial<DazzleLook> } = {},
    ) {
      const pop = { ...config, ...look };
      if (pop.sound) playSfx(pop.sound);
      seen.copy(at).project(camera);
      // Only a point inside the camera's depth range dazzles: beyond the far plane or before the
      // near one (behind an orthographic camera, z < -1) is out of view (#535 review).
      if (!inView(seen)) return;
      const reduced = reducedMotion();
      const x = ((seen.x + 1) / 2) * 100;
      const y = ((1 - seen.y) / 2) * 100;
      glare.style.background = `radial-gradient(circle at ${x}% ${y}%, #ffffff 0%, #f4f8ff 35%, #dfe8ff 100%)`;
      glare.style.opacity = String(reduced ? pop.glare.reduced : pop.glare.max * strength);
      glareFrames = config.flashFrames;
      const aspect = host.clientWidth / Math.max(1, host.clientHeight) || 1;
      const { centre, fringe } = pop.colours;
      for (const circle of popPattern(pop, strength, random)) {
        const element = document.createElement("div");
        Object.assign(element.style, {
          position: "absolute",
          borderRadius: "50%",
          transform: "translate(-50%, -50%)",
          background: `radial-gradient(closest-side, ${centre}, ${centre} 55%, color-mix(in srgb, ${fringe} 85%, transparent) 75%, color-mix(in srgb, ${fringe} 0%, transparent) 100%)`,
          mixBlendMode: "screen",
          opacity: reduced ? "0.35" : "1",
        });
        layer.append(element);
        blooms.push({
          element,
          x: x + (circle.dx * 100) / aspect,
          y: y + circle.dy * 100,
          radius: circle.radius * 100,
          frame: 0,
          frames: circle.frames,
        });
      }
    },
    /** Advance: the glare's frames, each bloom a frame, each afterimage by `delta` seconds. */
    update(delta: number) {
      if (glareFrames > 0 && --glareFrames === 0) glare.style.opacity = "0";
      for (let i = blooms.length - 1; i >= 0; i--) {
        const b = blooms[i]!;
        b.frame++;
        if (b.frame > b.frames) {
          b.element.remove();
          blooms.splice(i, 1);
          ghost(b.x, b.y, b.radius);
          continue;
        }
        const r = b.radius * bloom(b.frame, b.frames);
        Object.assign(b.element.style, {
          left: `${b.x}%`,
          top: `${b.y}%`,
          width: `${2 * r}vh`,
          height: `${2 * r}vh`,
        });
      }
      for (let i = ghosts.length - 1; i >= 0; i--) {
        const g = ghosts[i]!;
        g.age += delta;
        const level = ghostLevel(g.age, g.seconds);
        g.element.style.opacity = level.toFixed(3);
        if (level <= 0) {
          g.element.remove();
          ghosts.splice(i, 1);
        }
      }
    },
    /** Afterimages and blooms on screen now. */
    get active(): number {
      return blooms.length + ghosts.length;
    },
    dispose() {
      layer.remove();
      blooms.length = 0;
      ghosts.length = 0;
    },
  };
}
