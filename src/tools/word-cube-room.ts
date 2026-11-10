/**
 * The menu block audition room (dev13, #303): the game's menu items as word cubes, made by the
 * real creator (src/word-cube.ts), so their look and feel can be judged before the production
 * menus move to blocks. Hover a cube to lift it, press to push it in, release to activate:
 * the room shows the action it would dispatch, without running it. A disabled cube greys out,
 * refuses activation and explains itself through its inspectable trait.
 *
 * The cubes are drawn with the title screen's look (src/visual/attract-look.ts). Which items
 * appear is the scene's `devWordCubeRoom` configuration; this file names none of them.
 * Developer-only: production never imports it (src/main.ts).
 */
import * as THREE from "three";
import { gameModeFor, modeLink, type MenuBlockItem, type SceneTraits } from "../game-modes";
import { setReflectionEnvironment } from "../visual/block-appearance";
import {
  addAttractLighting,
  attractFieldOfView,
  configureAttractRenderer,
  sparkleEnvironment,
} from "../visual/attract-look";
import { createWordCube } from "../word-cube";
import "./word-cube-room.css";

export type WordCubeRoomConfig = SceneTraits["devWordCubeRoom"];

export type WordCubeRoom = {
  show(config: WordCubeRoomConfig): void;
  hide(): void;
  dispose(): void;
};

/** Cubes per row, and the distance between neighbouring cube centres. */
const perRow = 4;
const spacing = 1.7;

/** Where each of `count` cubes sits: rows of `perRow`, centred on the origin. */
export function gridPositions(count: number): THREE.Vector3[] {
  const rows = Math.ceil(count / perRow);
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / perRow);
    const inRow = Math.min(perRow, count - row * perRow);
    const column = index % perRow;
    return new THREE.Vector3(
      (column - (inRow - 1) / 2) * spacing,
      ((rows - 1) / 2 - row) * spacing,
      0,
    );
  });
}

type Cube = Awaited<ReturnType<typeof createWordCube>> & { index: number };

export function createWordCubeRoom(host: HTMLElement): WordCubeRoom {
  const root = document.createElement("section");
  root.className = "word-cube-room";
  root.hidden = true;
  root.innerHTML = `
    <header class="word-cube-room-header">
      <h1>Menu blocks</h1>
      <a data-part="back" href="#">Back to the game</a>
    </header>
    <div class="word-cube-room-stage" data-part="stage"></div>
    <footer class="word-cube-room-readout">
      <p>Action: <output data-part="action">none yet</output></p>
      <p>Inspect: <output data-part="inspect">hover or tap a block</output></p>
    </footer>`;
  host.append(root);
  const part = <T extends HTMLElement>(name: string) =>
    root.querySelector<T>(`[data-part="${name}"]`)!;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  configureAttractRenderer(renderer);
  part("stage").append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070b);
  addAttractLighting(scene);
  const environment = sparkleEnvironment(renderer, 0);
  const camera = new THREE.PerspectiveCamera(attractFieldOfView, 1, 0.1, 100);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let cubes: Cube[] = [];
  let hovered: Cube | null = null;
  let frame = 0;
  let last = performance.now();
  let built = 0;

  function clear(): void {
    cubes.forEach((cube) => cube.dispose());
    cubes = [];
    hovered = null;
  }

  async function build(items: readonly MenuBlockItem[]): Promise<void> {
    const generation = ++built;
    clear();
    const positions = gridPositions(items.length);
    const made = await Promise.all(
      items.map(async (item, index) => {
        const cube = await createWordCube(item.label, {
          id: `menu-block-${index}`,
          action: item.action,
          enabled: item.enabled,
          description: item.description,
          feedback: { reducedMotion },
        });
        cube.object.position.copy(positions[index]!);
        cube.block.on("menu.action", (action) => (part("action").textContent = String(action)));
        cube.block.on("inspection", (text) => (part("inspect").textContent = String(text)));
        return { ...cube, index };
      }),
    );
    // A newer build started while this one loaded its fonts: it wins.
    if (generation !== built) return made.forEach((cube) => cube.dispose());
    cubes = made;
    cubes.forEach((cube) => scene.add(cube.object));
    fit(positions);
  }

  /** Back the camera off until every cube fits the stage at its current aspect. */
  function fit(positions: readonly THREE.Vector3[]): void {
    const width = Math.max(...positions.map(({ x }) => Math.abs(x)), 0) * 2 + spacing;
    const height = Math.max(...positions.map(({ y }) => Math.abs(y)), 0) * 2 + spacing;
    const tan = Math.tan(THREE.MathUtils.degToRad(attractFieldOfView / 2));
    camera.position.set(0, 0, Math.max(height / (2 * tan), width / (2 * tan * camera.aspect)) + 1);
    camera.lookAt(0, 0, 0);
  }

  // Pointer input becomes the cubes' own input events; their traits do the rest.
  const ray = new THREE.Raycaster();
  // Only a cube's faces count. Its outline is drawn with lines, which a raycaster otherwise
  // catches from a whole unit away, so a neighbour's edge would win the hit.
  ray.params.Line.threshold = 0;
  ray.params.Points.threshold = 0;
  const pointer = new THREE.Vector2();
  function cubeAt(event: PointerEvent): Cube | null {
    const bounds = renderer.domElement.getBoundingClientRect();
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
  function hover(next: Cube | null): void {
    if (next === hovered) return;
    hovered?.block.emit("input.leave");
    hovered = next;
    hovered?.block.emit("input.enter");
  }
  const canvas = renderer.domElement;
  canvas.addEventListener("pointermove", (event) => hover(cubeAt(event)));
  canvas.addEventListener("pointerdown", (event) => {
    hover(cubeAt(event));
    hovered?.block.emit("input.press");
  });
  canvas.addEventListener("pointerup", (event) => {
    hover(cubeAt(event));
    cubes.forEach(({ block }) => block.emit("input.release"));
  });
  canvas.addEventListener("pointerleave", () => {
    cubes.forEach(({ block }) => block.emit("input.cancel"));
    hovered = null;
  });

  function resize(): void {
    const stage = part("stage");
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    fit(gridPositions(cubes.length));
  }
  const observer = new ResizeObserver(resize);
  observer.observe(part("stage"));

  function tick(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // The scene's own animation: a gentle sway on each cube's outer group, so its faces catch
    // the light. Interaction feedback moves only the inner group, so the two compose.
    for (const cube of cubes) {
      const sway = reducedMotion ? 0 : now / 1000 + cube.index * 0.7;
      cube.object.rotation.set(Math.sin(sway * 0.6) * 0.18, Math.sin(sway * 0.45) * 0.35, 0);
      cube.block.update(dt);
    }
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  }

  return {
    show(config) {
      part<HTMLAnchorElement>("back").href = modeLink(
        gameModeFor(config.backTo),
        window.location.href,
      ).href;
      // Blocks made in the room reflect its own studio; the game draws none here.
      setReflectionEnvironment(environment);
      root.hidden = false;
      void build(config.items);
      resize();
      last = performance.now();
      frame = requestAnimationFrame(tick);
    },
    hide() {
      root.hidden = true;
      cancelAnimationFrame(frame);
      built++;
      clear();
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      clear();
      environment.dispose();
      renderer.dispose();
      root.remove();
    },
  };
}

/** Whether `child` is `ancestor` or inside it. */
function isWithin(child: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = child; node; node = node.parent)
    if (node === ancestor) return true;
  return false;
}
