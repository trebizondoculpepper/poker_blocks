import * as THREE from "three";
import { createWord } from "./letter-block";
import {
  addAttractLighting,
  attractFieldOfView,
  configureAttractRenderer,
  sparkleEnvironment,
} from "./visual/attract-look";
import { boardFinish } from "./visual/written-block";
import { createPrepassContext } from "./visual/appearance-prepass";
import { beatShapes, bouncePhase } from "./dance/beat-shapes";
import { danceCycles, type DanceFloor, type DanceMove } from "./dance/dance-floor";
import type { BlockTitleConfig, BlockTitles } from "./scene-traits/block-title";

/** Circular pitch/yaw around a word's centre, without rolling about its forward axis. */
export function precessTitleRow(
  row: THREE.Group,
  seconds: number,
  index: number,
  count: number,
  config: BlockTitleConfig,
  energy: number,
): void {
  const phase =
    Math.PI *
    2 *
    (seconds / (config.precession?.seconds ?? 16) +
      (index * (config.precession?.phaseDegrees ?? 360 / Math.max(1, count))) / 360);
  const angle = THREE.MathUtils.degToRad(config.precession?.angle ?? 7) * energy;
  // A constant cone angle gives the forward ray an exactly circular intersection.
  row.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(
      Math.sin(angle) * Math.cos(phase),
      Math.sin(angle) * Math.sin(phase),
      Math.cos(angle),
    ),
  );
}

/**
 * A rigid row follows the shared dance floor; no separate clock or music analysis. Its tilt
 * swings side to side once over its cycle.
 */
export function tiltTitleRow(row: THREE.Group, config: BlockTitleConfig, move: DanceMove): void {
  const wave = Math.sin(move.phase * Math.PI * 2);
  row.rotation.z = wave * THREE.MathUtils.degToRad(config.dance?.tilt ?? 3) * move.energy;
}

/** A standard normal sample (Box-Muller), for the blocks' messiness. */
function standardNormal(random: () => number = Math.random): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

/** One letter block's own deviation from perfect order, in standard deviations. */
export type BounceJitter = {
  time: number;
  leanX: number;
  leanZ: number;
  /** Its resting turn about each axis. */
  turn: readonly [number, number, number];
};

export function bounceJitter(random: () => number = Math.random): BounceJitter {
  const draw = () => standardNormal(random);
  return { time: draw(), leanX: draw(), leanZ: draw(), turn: [draw(), draw(), draw()] };
}

/** A block's resting orientation: its own rest, turned by its jitter times the spread. */
export function restTurn(
  block: THREE.Object3D,
  rest: THREE.Euler,
  config: BlockTitleConfig,
  jitter: BounceJitter,
): void {
  const spread = THREE.MathUtils.degToRad(config.dance?.restAngleSpread ?? 0);
  const [x, y, z] = jitter.turn;
  block.rotation.set(rest.x + x * spread, rest.y + y * spread, rest.z + z * spread);
}

const up = new THREE.Vector3(0, 1, 0);
const lean = new THREE.Euler();

/** The way a block bounces: vertical, leaned off true by its jitter and the angle spread. */
export function bounceDirection(
  config: BlockTitleConfig,
  jitter: BounceJitter,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  const spread = THREE.MathUtils.degToRad(config.dance?.bounceAngleSpread ?? 0);
  lean.set(jitter.leanX * spread, 0, jitter.leanZ * spread);
  return target.copy(up).applyEuler(lean);
}

/**
 * A block's lift: once over its own cycle, shaped by its registered beat shape, from its rest
 * position along its bounce direction.
 */
export function bounceTitleBlock(
  block: THREE.Object3D,
  rest: THREE.Vector3,
  direction: THREE.Vector3,
  config: BlockTitleConfig,
  move: DanceMove,
): void {
  const attack = config.dance?.bounceAttack ?? 0.5;
  const hop = beatShapes.get(config.dance?.bounceShape ?? "bounce")(
    bouncePhase(move.phase, config.dance?.bounceWindow, attack),
    attack,
  );
  block.position
    .copy(rest)
    .addScaledVector(direction, hop * (config.dance?.bounce ?? 0.08) * move.energy);
}

type TitleView = { config: BlockTitleConfig; frame(): void; dispose(): void };
/** Reusable view service. The caller supplies its mounting surface, never a scene identity. */
export function createBlockTitles(parent: () => HTMLElement, floor: DanceFloor): BlockTitles {
  const views = new Set<TitleView>();
  return {
    tuning() {
      const config = [...views].at(-1)?.config;
      const count = config?.text.trim().split(/\s+/u).filter(Boolean).length ?? 2;
      return {
        scale: config?.scale ?? 1,
        phaseDegrees: config?.precession?.phaseDegrees ?? 360 / Math.max(1, count),
        precessionAngle: config?.precession?.angle ?? 7,
        precessionSeconds: config?.precession?.seconds ?? 16,
        bounce: config?.dance?.bounce ?? 0.08,
        bounceCycle: config?.dance?.bounceCycle ?? "halfBeat",
        bounceShape: config?.dance?.bounceShape ?? "bounce",
        bounceWindow: config?.dance?.bounceWindow ?? 1,
        bounceAttack: config?.dance?.bounceAttack ?? 0.5,
        bounceTimeSpread: config?.dance?.bounceTimeSpread ?? 0,
        bounceAngleSpread: config?.dance?.bounceAngleSpread ?? 0,
        restAngleSpread: config?.dance?.restAngleSpread ?? 0,
      };
    },
    retune(next) {
      const finite = [
        next.phaseDegrees,
        next.precessionAngle,
        next.bounce,
        next.bounceTimeSpread,
        next.bounceAngleSpread,
        next.restAngleSpread,
      ];
      if (
        !(next.scale > 0 && next.precessionSeconds > 0) ||
        !(next.bounceWindow > 0 && next.bounceWindow <= 1) ||
        !(next.bounceAttack > 0 && next.bounceAttack < 1) ||
        !beatShapes.has(next.bounceShape) ||
        !finite.every(Number.isFinite) ||
        !danceCycles.has(next.bounceCycle)
      )
        throw new Error("Invalid block title tuning");
      for (const view of views) {
        view.config.scale = next.scale;
        view.config.precession = {
          ...view.config.precession,
          phaseDegrees: next.phaseDegrees,
          angle: next.precessionAngle,
          seconds: next.precessionSeconds,
        };
        view.config.dance = {
          ...view.config.dance,
          bounce: next.bounce,
          bounceCycle: next.bounceCycle,
          bounceShape: next.bounceShape,
          bounceWindow: next.bounceWindow,
          bounceAttack: next.bounceAttack,
          bounceTimeSpread: next.bounceTimeSpread,
          bounceAngleSpread: next.bounceAngleSpread,
          restAngleSpread: next.restAngleSpread,
        };
      }
    },
    show(definition) {
      const config = structuredClone(definition);
      if (!(config.scale > 0 && Number.isFinite(config.scale)))
        throw new Error("Block title scale must be positive");
      const container = document.createElement("div");
      container.className = "block-title";
      container.setAttribute("role", "heading");
      container.setAttribute("aria-level", "1");
      container.setAttribute("aria-label", config.text);
      parent().append(container);
      // Drawn exactly as the attract cards behind it are: their camera, lights, reflections and
      // output (src/visual/attract-look.ts), so the blocks look like the same objects.
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      configureAttractRenderer(renderer);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
      container.append(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(attractFieldOfView, 1, 0.1, 200);
      addAttractLighting(scene);
      // The attract cards' room and strip lights, without their coloured sparkle points, which
      // on blocks this close read as specks.
      const environment = sparkleEnvironment(renderer, 0);
      scene.environment = environment;
      // The letters' prepasses (a crystal letter's inner capture), on this view's renderer (#971).
      const prepasses = createPrepassContext();
      const title = new THREE.Group();
      title.scale.setScalar(config.scale);
      scene.add(title);
      const rows: Awaited<ReturnType<typeof createWord>>[] = [];
      const precessions: { pivot: THREE.Group; index: number; energy: number }[] = [];
      const started = performance.now();
      const leave: (() => void)[] = [];
      let alive = true;
      const words = config.text.trim().split(/\s+/u).filter(Boolean);
      const resize = () => {
        const width = Math.max(1, container.clientWidth);
        const height = Math.max(1, container.clientHeight);
        renderer.setSize(width, height, false);
        const longest = Math.max(1, ...words.map((word) => Array.from(word).length));
        // The longest row fills two-thirds of the viewport, with room for its tilt.
        const rowHeight = (words.length - 1) * (config.rowSpacing ?? 1.45) + 1.5;
        const halfWidth = Math.max(
          (longest * 1.1) / (2 * (2 / 3)),
          (rowHeight * width) / (height * 1.2),
        );
        // The attract camera's perspective, backed off until the title's plane (z = 0) shows
        // the same frame the flat camera did: `halfWidth` either side.
        const halfHeight = (halfWidth * height) / width;
        const distance = halfHeight / Math.tan(THREE.MathUtils.degToRad(attractFieldOfView / 2));
        camera.aspect = width / height;
        camera.position.set(0, -halfHeight * 0.3, distance);
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      resize();
      const release = () => {
        alive = false;
        observer.disconnect();
        leave.forEach((stop) => stop());
        rows.forEach((row) => row.dispose());
        prepasses.dispose();
        environment.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        title.clear();
        views.delete(view);
      };
      const view: TitleView = {
        config,
        frame() {
          if (!alive) return;
          title.scale.setScalar(config.scale);
          const seconds = (performance.now() - started) / 1000;
          for (const motion of precessions) {
            precessTitleRow(
              motion.pivot,
              seconds,
              motion.index,
              words.length,
              config,
              motion.energy,
            );
          }
          prepasses.render({
            renderer,
            scene,
            camera,
            hide: scene,
            delta: 0,
            reducedMotion: false,
          });
          renderer.render(scene, camera);
        },
        dispose() {
          if (!alive) {
            container.remove();
            return;
          }
          release();
          container.remove();
        },
      };
      views.add(view);
      void Promise.all(
        words.map(async (word, index) => {
          const row = await createWord(word, { finish: boardFinish });
          if (!alive) {
            row.dispose();
            return;
          }
          rows.push(row);
          // Held for the view's life: the context is disposed with it.
          for (const letter of row.letters) prepasses.require(letter.prepasses);
          // Material environment textures belong to this renderer, never another WebGL context.
          // Only each block's own faces reflect it: its extras (a fire's glass, crystal fire)
          // keep their own look, so no reflection slides over the flame.
          for (const material of row.letters.flatMap(({ surfaces }) => surfaces)) {
            (material as THREE.MeshStandardMaterial).envMap = environment;
            material.needsUpdate = true;
          }
          const restY = ((words.length - 1) / 2 - index) * (config.rowSpacing ?? 1.45);
          const pivot = new THREE.Group();
          pivot.position.y = restY;
          pivot.add(row.object);
          row.object.position.y = 0;
          title.add(pivot);
          const motion = { pivot, index, energy: 0 };
          precessions.push(motion);
          const offset = index * (config.dance?.phaseStep ?? 0.12);
          leave.push(
            floor.join({
              cycle: config.dance?.cycle ?? "beat",
              offset,
              dance: (move) => {
                motion.energy = move.energy;
                tiltTitleRow(row.object, config, move);
              },
            }),
            // Each letter block bounces on its own, a little off the beat and off vertical by
            // its own jitter. Cycle and spreads are read each frame, so retuning (dev7) is live.
            ...row.object.children.map((block) => {
              const rest = block.position.clone();
              const restRotation = block.rotation.clone();
              const jitter = bounceJitter();
              const direction = new THREE.Vector3();
              return floor.join({
                get cycle() {
                  return config.dance?.bounceCycle ?? "halfBeat";
                },
                get offset() {
                  return offset + jitter.time * (config.dance?.bounceTimeSpread ?? 0);
                },
                // Called every frame, music or not, so the resting turn holds in silence too.
                dance: (move) => {
                  restTurn(block, restRotation, config, jitter);
                  bounceTitleBlock(
                    block,
                    rest,
                    bounceDirection(config, jitter, direction),
                    config,
                    move,
                  );
                },
              });
            }),
          );
        }),
      ).catch((error) => {
        if (!alive) return;
        release();
        container.textContent = config.text;
        console.error("Unable to create block title", error);
      });
      return () => view.dispose();
    },
    frame() {
      views.forEach((view) => view.frame());
    },
    mounted() {
      return [...views].map(({ config }) => ({ text: config.text, scale: config.scale }));
    },
    dispose() {
      [...views].forEach((view) => view.dispose());
    },
  };
}
