import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createWord } from "./letter-block";
import type { DanceFloor, DanceMove } from "./dance/dance-floor";
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
    Math.PI * 2 * (seconds / (config.precession?.seconds ?? 16) + index / Math.max(1, count));
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

/** A rigid row follows the shared dance floor; no separate clock or music analysis. */
export function danceTitleRow(
  row: THREE.Group,
  restY: number,
  config: BlockTitleConfig,
  move: DanceMove,
): void {
  const wave = Math.sin(move.phase * Math.PI * 2);
  row.position.y = restY + Math.abs(wave) * (config.dance?.bounce ?? 0.08) * move.energy;
  row.rotation.z = wave * THREE.MathUtils.degToRad(config.dance?.tilt ?? 3) * move.energy;
}

type TitleView = { frame(): void; dispose(): void };
/** Reusable view service. The caller supplies its mounting surface, never a scene identity. */
export function createBlockTitles(parent: () => HTMLElement, floor: DanceFloor): BlockTitles {
  const views = new Set<TitleView>();
  return {
    show(config) {
      if (!(config.scale > 0 && Number.isFinite(config.scale)))
        throw new Error("Block title scale must be positive");
      const container = document.createElement("div");
      container.className = "block-title";
      container.setAttribute("role", "heading");
      container.setAttribute("aria-level", "1");
      container.setAttribute("aria-label", config.text);
      parent().append(container);
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
      container.append(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-4, 4, 2, -2, 0.1, 100);
      camera.position.z = 10;
      scene.add(new THREE.AmbientLight(0xffffff, 1.2));
      const light = new THREE.DirectionalLight(0xffffff, 2);
      light.position.set(3, 5, 8);
      scene.add(light);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      const environment = pmrem.fromScene(room);
      room.dispose();
      pmrem.dispose();
      scene.environment = environment.texture;
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
          (rowHeight * config.scale * width) / (height * 1.2),
        );
        camera.left = -halfWidth;
        camera.right = halfWidth;
        const halfHeight = (halfWidth * height) / width;
        camera.position.y = -halfHeight * 0.3;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
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
        environment.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        title.clear();
        views.delete(view);
      };
      const view: TitleView = {
        frame() {
          if (!alive) return;
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
          const row = await createWord(word);
          if (!alive) {
            row.dispose();
            return;
          }
          rows.push(row);
          // Material environment textures belong to this renderer, never another WebGL context.
          row.object.traverse((child) => {
            const mesh = child as THREE.Mesh;
            for (const material of ([] as THREE.Material[]).concat(mesh.material ?? [])) {
              (material as THREE.MeshStandardMaterial).envMap = environment.texture;
              material.needsUpdate = true;
            }
          });
          const restY = ((words.length - 1) / 2 - index) * (config.rowSpacing ?? 1.45);
          const pivot = new THREE.Group();
          pivot.position.y = restY;
          pivot.add(row.object);
          row.object.position.y = 0;
          title.add(pivot);
          const motion = { pivot, index, energy: 0 };
          precessions.push(motion);
          leave.push(
            floor.join({
              cycle: config.dance?.cycle ?? "beat",
              offset: index * (config.dance?.phaseStep ?? 0.12),
              dance: (move) => {
                motion.energy = move.energy;
                danceTitleRow(row.object, 0, config, move);
              },
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
    dispose() {
      [...views].forEach((view) => view.dispose());
    },
  };
}
