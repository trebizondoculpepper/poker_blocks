/**
 * A stage for word cubes (#528): a canvas drawn with the title screen's look
 * (src/visual/attract-look.ts), a camera that fits whatever is shown, and pointer input turned
 * into each cube's own `input.*` events, so the cubes' traits do the rest. Its callers (the
 * production block menus, src/block-menu/block-menus.ts, and the developer rooms) decide what to
 * show and where; the stage knows nothing of menus or dialogs.
 *
 * Over the game it is transparent and leaves the game's reflections alone; a developer room gives
 * it a `background` and lets it `reflect` its own studio (`StageOptions`).
 */
import * as THREE from "three";
import { createPointerRouter } from "./pointer-router";
import type { MenuBlockItem } from "../game-modes";
import {
  addAttractLighting,
  attractFieldOfView,
  configureAttractRenderer,
  sparkleEnvironment,
} from "../visual/attract-look";
import { createWordCube, type WordCubeOptions } from "../word-cube";

export type StageCube = Awaited<ReturnType<typeof createWordCube>> & { index: number };

export type CubeStage = {
  readonly reducedMotion: boolean;
  /** Replace what is shown: one cube per item, at its position. Resolves when they are built. */
  show(
    items: readonly MenuBlockItem[],
    positions: readonly THREE.Vector3[],
    options?: (item: MenuBlockItem, index: number) => Partial<WordCubeOptions>,
  ): Promise<StageCube[]>;
  clear(): void;
  /** Start drawing; `frame` runs for each cube every frame, before its traits update. */
  start(frame?: (cube: StageCube, seconds: number, dt: number) => void): void;
  stop(): void;
  dispose(): void;
};

export type StageOptions = {
  /** A solid background colour; omitted, the stage is transparent over whatever is behind. */
  background?: number;
  /**
   * Hand the stage's studio environment to the block appearance (a developer room, where no game
   * draws). Omitted, the game's own reflections stay as they are.
   */
  reflect?: (environment: THREE.Texture) => void;
};

export function createCubeStage(host: HTMLElement, look: StageOptions = {}): CubeStage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  configureAttractRenderer(renderer);
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = look.background === undefined ? null : new THREE.Color(look.background);
  addAttractLighting(scene);
  const environment = sparkleEnvironment(renderer, 0);
  const camera = new THREE.PerspectiveCamera(attractFieldOfView, 1, 0.1, 100);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let cubes: StageCube[] = [];
  let shown: readonly THREE.Vector3[] = [];
  let generation = 0;
  let frame = 0;
  let last = performance.now();
  let perFrame: (cube: StageCube, seconds: number, dt: number) => void = () => {};

  function clear(): void {
    generation++;
    cubes.forEach((cube) => cube.dispose());
    cubes = [];
    router.forget();
  }

  /** Back the camera off until every position fits, with a cube's margin around them. */
  function fit(): void {
    const margin = 1.8;
    const width = Math.max(0, ...shown.map(({ x }) => Math.abs(x))) * 2 + margin;
    const height = Math.max(0, ...shown.map(({ y }) => Math.abs(y))) * 2 + margin;
    const tan = Math.tan(THREE.MathUtils.degToRad(attractFieldOfView / 2));
    camera.position.set(0, 0, Math.max(height / (2 * tan), width / (2 * tan * camera.aspect)) + 1);
    camera.lookAt(0, 0, 0);
  }

  // Only a cube's faces count. Its outline is drawn with lines, which a raycaster otherwise
  // catches from a whole unit away, so a neighbour's edge would win the hit.
  const ray = new THREE.Raycaster();
  ray.params.Line.threshold = 0;
  ray.params.Points.threshold = 0;
  const pointer = new THREE.Vector2();
  const canvas = renderer.domElement;
  function cubeAt(event: PointerEvent): StageCube | null {
    const bounds = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
    const [hit] = ray.intersectObjects(
      cubes.map(({ object }) => object),
      true,
    );
    return cubes.find(({ object }) => hit && isWithin(hit.object, object)) ?? null;
  }
  const router = createPointerRouter(() => cubes);
  canvas.addEventListener("pointermove", (event) => router.move(cubeAt(event), event.pointerType));
  canvas.addEventListener("pointerdown", (event) => router.down(cubeAt(event), event.pointerType));
  canvas.addEventListener("pointerup", (event) => router.up(cubeAt(event), event.pointerType));
  canvas.addEventListener("pointerleave", () => router.leave());

  function resize(): void {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    fit();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  function tick(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const cube of cubes) {
      perFrame(cube, now / 1000, dt);
      cube.block.update(dt);
    }
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  }

  return {
    reducedMotion,
    async show(items, positions, options = () => ({})) {
      clear();
      const mine = generation;
      // Only a developer room hands over its studio; over the game, its reflections stay.
      look.reflect?.(environment);
      const made = await Promise.all(
        items.map(async (item, index) => {
          const cube = await createWordCube(item.label, {
            id: `stage-cube-${index}`,
            action: item.action,
            enabled: item.enabled,
            description: item.description,
            disabledReason: item.disabledReason,
            feedback: { reducedMotion },
            ...options(item, index),
          });
          cube.object.position.copy(positions[index]!);
          return { ...cube, index };
        }),
      );
      // Something newer was shown while this one loaded its fonts: it wins.
      if (mine !== generation) {
        made.forEach((cube) => cube.dispose());
        return [];
      }
      cubes = made;
      shown = positions;
      cubes.forEach((cube) => scene.add(cube.object));
      resize();
      return cubes;
    },
    clear,
    start(frameHook) {
      perFrame = frameHook ?? (() => {});
      resize();
      last = performance.now();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    },
    stop() {
      cancelAnimationFrame(frame);
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      clear();
      environment.dispose();
      renderer.dispose();
    },
  };
}

/** Whether `child` is `ancestor` or inside it. */
function isWithin(child: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = child; node; node = node.parent)
    if (node === ancestor) return true;
  return false;
}
